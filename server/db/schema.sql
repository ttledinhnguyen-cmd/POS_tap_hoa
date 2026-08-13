-- =============================================================================
-- schema.sql — Schema Tạp Hóa POS trên PostgreSQL thuần (thay Supabase)
-- =============================================================================
-- Gộp từ 15 migration Supabase (0001→0015) thành trạng thái cuối. Không chép
-- lại từng bước vì nhiều migration là sửa lỗi migration trước (0004 sửa 0002,
-- 0014 backfill 0013, 0015 sửa 0010) — replay lại chỉ tổ rối.
--
-- BA THỨ CỦA SUPABASE ĐƯỢC THAY:
--
--   auth.users                → public.users (tự quản lý, có password_hash)
--   auth.uid()                → public.current_user_id(), đọc biến phiên
--                               app.user_id do API set mỗi request
--   extensions.moddatetime    → public.set_updated_at()
--   publication supabase_realtime → bỏ, realtime làm bằng SSE ở tầng API
--
-- MÔ HÌNH ROLE — đọc kỹ trước khi sửa:
--
--   ipos_owner  sở hữu mọi bảng + function. NOLOGIN. Không ai kết nối bằng role
--               này. SECURITY DEFINER function chạy dưới quyền nó nên bỏ qua
--               được RLS — đó là cách các RPC ghi vào bảng mà client bị RLS chặn.
--
--   ipos_app    role API dùng để kết nối. KHÔNG sở hữu bảng nào, nên RLS áp
--               dụng đầy đủ. Đây là điểm mấu chốt: chủ sở hữu bảng mặc định
--               BỎ QUA RLS, nếu để ipos_app sở hữu thì mọi policy thành vô nghĩa
--               và một lỗi thiếu WHERE org_id trong API sẽ làm lộ dữ liệu
--               giữa các tiệm.
--
-- FILE NÀY LÀ ẢNH CHỤP TẠI THỜI ĐIỂM TÁCH KHỎI SUPABASE, KHÔNG PHẢI TRẠNG THÁI
-- HIỆN TẠI. Mọi thay đổi sau đó nằm ở server/db/migrations/ và đó mới là nguồn
-- sự thật. Đừng chép tay migration ngược vào đây — chép tay là sót, mà sót chỉ
-- lộ ra đúng lúc cần nhất: khi khôi phục sau sự cố.
--
-- Áp dụng: server/db/apply-schema.ps1 chạy file này rồi replay toàn bộ
-- migration theo thứ tự tên. Bản cài mới vì thế luôn khớp với DB đang chạy.
-- =============================================================================

create extension if not exists pgcrypto;
-- unaccent: khớp tên nhà cung cấp bỏ dấu tiếng Việt (xem vn_norm)
create extension if not exists unaccent;

-- =============================================================================
-- Nền tảng: thay thế các tiện ích của Supabase
-- =============================================================================

-- Thay extensions.moddatetime của Supabase.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Thay auth.uid(). API gọi `set_config('app.user_id', <uuid>, true)` đầu mỗi
-- transaction; tham số thứ ba = true nghĩa là LOCAL, tự hết hiệu lực khi
-- transaction kết thúc nên không rò rỉ sang request sau trên cùng connection
-- của pool.
--
-- Trả NULL khi chưa set (request chưa đăng nhập) — mọi policy so sánh với NULL
-- đều false, tức deny mặc định.
create or replace function public.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- =============================================================================
-- users — thay auth.users
-- =============================================================================
create table public.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,
  password_hash       text not null,
  email_confirmed_at  timestamptz,
  last_sign_in_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Email không phân biệt hoa thường (Supabase cũng vậy).
create unique index users_email_lower_uniq on public.users (lower(email));

create trigger users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Refresh token: lưu HASH chứ không lưu token gốc — lộ DB không dựng lại được
-- phiên. Xoay vòng mỗi lần refresh (revoked_at + replaced_by).
create table public.refresh_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  token_hash   text not null unique,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  replaced_by  uuid references public.refresh_tokens(id) on delete set null,
  user_agent   text,
  created_at   timestamptz not null default now()
);

create index refresh_tokens_user_idx on public.refresh_tokens(user_id)
  where revoked_at is null;

-- Token một lần cho reset mật khẩu và mời chủ shop.
create table public.auth_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  token_hash  text not null unique,
  purpose     text not null check (purpose in ('password_reset', 'invite')),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index auth_tokens_user_purpose_idx on public.auth_tokens(user_id, purpose)
  where used_at is null;

-- =============================================================================
-- organizations — mỗi tiệm 1 row
-- =============================================================================
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  tax_code      text,
  address       text,
  phone         text,
  latitude      numeric(10,7),
  longitude     numeric(10,7),
  address_full  text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- =============================================================================
-- memberships — user × org × role
-- =============================================================================
create table public.memberships (
  user_id     uuid not null references public.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  role        text not null check (role in ('owner', 'cashier')),
  created_at  timestamptz not null default now(),
  primary key (user_id, org_id)
);

create index memberships_org_idx on public.memberships(org_id);

-- Danh sách org của user hiện tại. SECURITY DEFINER để bỏ qua RLS của
-- memberships — nếu không sẽ đệ quy vô hạn (bài học 0004_fix_rls_recursion).
create or replace function public.user_org_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from public.memberships where user_id = public.current_user_id()
$$;

-- =============================================================================
-- categories
-- =============================================================================
create table public.categories (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  name           text not null,
  display_order  int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index categories_org_name_uniq on public.categories(org_id, name);
create index categories_org_order_idx on public.categories(org_id, display_order);

create trigger categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- =============================================================================
-- products
-- =============================================================================
-- Tiền lưu bigint (đồng VND), KHÔNG float — tránh sai số 0.1+0.2.
-- stock numeric(10,2) để bán lẻ 0.5kg.
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  barcode      text,
  name         text not null,
  unit         text not null default 'cái',
  price_buy    bigint not null default 0,
  price_sell   bigint not null default 0,
  stock        numeric(10,2) not null default 0,
  tax_rate     numeric(4,2) not null default 8 check (tax_rate in (0, 5, 8, 10)),
  category     text,
  image_url    text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index products_org_barcode_idx on public.products(org_id, barcode);
create index products_org_name_idx on public.products(org_id, name text_pattern_ops);

-- Cấm 2 sản phẩm trùng EAN-13 trong cùng tiệm, nhưng cho phép nhiều sản phẩm
-- không mã vạch (hàng tự đặt) cùng tồn tại.
create unique index products_org_barcode_unique
  on public.products(org_id, barcode)
  where barcode is not null;

create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- =============================================================================
-- orders + order_items
-- =============================================================================
create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  cashier_id            uuid references public.users(id) on delete set null,
  subtotal              bigint not null,
  tax_amount            bigint not null default 0,
  discount              bigint not null default 0,
  total                 bigint not null,
  payment_method        text not null check (payment_method in ('cash', 'transfer', 'qr', 'mixed')),
  cash_received         bigint,
  change_amount         bigint,
  customer_name         text,
  customer_phone        text,
  customer_tax_code     text,
  invoice_status        text not null default 'none'
                          check (invoice_status in ('none', 'pending', 'issued', 'failed', 'cancelled')),
  invoice_no            text,
  invoice_lookup_code   text,
  invoice_xml_url       text,
  invoice_pdf_url       text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index orders_org_created_idx on public.orders(org_id, created_at desc);
create index orders_invoice_status_idx on public.orders(invoice_status)
  where invoice_status in ('pending', 'failed');

-- Idempotent phát hành HĐĐT: retry không tạo trùng số hoá đơn trong cùng tiệm.
create unique index orders_org_invoice_no_unique
  on public.orders(org_id, invoice_no)
  where invoice_no is not null;

create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Snapshot tên + giá tại thời điểm bán, nên product_id ON DELETE SET NULL vẫn
-- giữ được lịch sử đọc hiểu.
create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  product_name  text not null,
  unit          text not null,
  quantity      numeric(10,2) not null,
  price_buy     bigint not null,
  price_sell    bigint not null,
  tax_rate      numeric(4,2) not null default 8 check (tax_rate in (0, 5, 8, 10)),
  line_total    bigint not null
);

create index order_items_order_idx on public.order_items(order_id);

-- =============================================================================
-- goods_receipts — nhập kho
-- =============================================================================
create table public.goods_receipts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  receiver_id        uuid references public.users(id) on delete set null,
  supplier_name      text,
  supplier_phone     text,
  supplier_tax_code  text,
  receipt_date       date not null default current_date,
  invoice_no         text,
  total_cost         bigint not null default 0,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index goods_receipts_org_date_idx on public.goods_receipts(org_id, receipt_date desc);

create trigger goods_receipts_updated_at
  before update on public.goods_receipts
  for each row execute function public.set_updated_at();

create table public.goods_receipt_items (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references public.goods_receipts(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  product_name  text not null,
  unit          text not null,
  quantity      numeric(10,2) not null,
  price_buy     bigint not null,
  line_total    bigint not null
);

create index goods_receipt_items_receipt_idx on public.goods_receipt_items(receipt_id);
create index goods_receipt_items_product_idx on public.goods_receipt_items(product_id);

-- =============================================================================
-- stock_takes — kiểm kê tồn kho
-- =============================================================================
-- Khác goods_receipts: kiểm kê đặt TUYỆT ĐỐI (stock = actual), không cộng trừ.
create table public.stock_takes (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  taker_id            uuid references public.users(id) on delete set null,
  take_date           date not null default current_date,
  status              text not null default 'in_progress'
                        check (status in ('in_progress', 'committed', 'cancelled')),
  notes               text,
  total_delta_value   bigint not null default 0,
  total_items_count   int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index stock_takes_org_date_idx on public.stock_takes(org_id, take_date desc);

create trigger stock_takes_updated_at
  before update on public.stock_takes
  for each row execute function public.set_updated_at();

create table public.stock_take_items (
  id              uuid primary key default gen_random_uuid(),
  stock_take_id   uuid not null references public.stock_takes(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  product_name    text not null,
  unit            text not null,
  expected_stock  numeric(10,2) not null,
  actual_count    numeric(10,2) not null default 0,
  delta           numeric(10,2) not null default 0,
  reason          text check (reason in ('shrinkage', 'damaged', 'expired', 'found', 'count_error', 'other')),
  unit_cost       bigint not null default 0,
  delta_value     bigint not null default 0,
  created_at      timestamptz not null default now()
);

create index stock_take_items_take_idx on public.stock_take_items(stock_take_id);
create index stock_take_items_product_idx on public.stock_take_items(product_id);

-- =============================================================================
-- shared_barcodes — kho mã vạch dùng chung giữa các tiệm
-- =============================================================================
-- KHÔNG lưu giá: giá là bí mật của từng tiệm.
create table public.shared_barcodes (
  barcode            text primary key,
  name               text not null,
  brand              text,
  category           text,
  default_unit       text default 'cái',
  image_url          text,
  contributor_count  int not null default 1,
  first_seen_at      timestamptz not null default now(),
  last_updated_at    timestamptz not null default now(),
  is_verified        boolean not null default false
);

create index shared_barcodes_brand_idx on public.shared_barcodes(brand) where brand is not null;

-- =============================================================================
-- subscriptions / super_admins — hạ tầng SaaS
-- =============================================================================
create table public.subscriptions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null unique references public.organizations(id) on delete cascade,
  tier              text not null default 'standard' check (tier in ('standard', 'pro')),
  status            text not null default 'trial'
                      check (status in ('trial', 'active', 'expired', 'suspended', 'cancelled')),
  monthly_price     bigint not null default 199000,
  trial_until_date  date,
  paid_until_date   date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index subscriptions_status_idx on public.subscriptions(status);
create index subscriptions_paid_until_idx on public.subscriptions(paid_until_date) where status = 'active';

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.subscription_payments (
  id               uuid primary key default gen_random_uuid(),
  subscription_id  uuid not null references public.subscriptions(id) on delete cascade,
  amount           bigint not null,
  payment_date     date not null default current_date,
  period_months    int not null,
  payment_method   text not null default 'bank_transfer'
                     check (payment_method in ('bank_transfer', 'cash', 'other')),
  recorded_by      uuid references public.users(id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now()
);

create index subscription_payments_sub_idx
  on public.subscription_payments(subscription_id, payment_date desc);

create table public.super_admins (
  user_id   uuid primary key references public.users(id) on delete cascade,
  added_at  timestamptz not null default now(),
  added_by  uuid references public.users(id) on delete set null
);

-- KHÔNG dùng user_org_ids() ở đây: super_admins không có policy gọi ngược nên
-- EXISTS trực tiếp là an toàn, còn đi vòng qua memberships thì đệ quy.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(select 1 from public.super_admins where user_id = public.current_user_id())
$$;

-- =============================================================================
-- webhook_events / outbox — chỉ tầng server dùng, client không đụng tới
-- =============================================================================
create table public.webhook_events (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,
  event_type       text not null,
  payload          jsonb not null,
  signature_valid  boolean,
  processed        boolean not null default false,
  processed_at     timestamptz,
  error            text,
  received_at      timestamptz not null default now()
);

create index webhook_events_source_processed_idx
  on public.webhook_events(source, processed, received_at desc);

create table public.outbox (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  type         text not null,
  payload      jsonb not null,
  status       text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts     int not null default 0,
  last_error   text,
  next_run_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index outbox_pending_idx on public.outbox(status, next_run_at) where status = 'pending';

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
-- ipos_app KHÔNG sở hữu các bảng này nên RLS áp dụng đầy đủ. Bảng nào không có
-- policy nào = deny toàn bộ với ipos_app, chỉ SECURITY DEFINER function (chạy
-- dưới quyền ipos_owner) mới đụng được.
alter table public.users                 enable row level security;
alter table public.refresh_tokens        enable row level security;
alter table public.auth_tokens           enable row level security;
alter table public.organizations         enable row level security;
alter table public.memberships           enable row level security;
alter table public.categories            enable row level security;
alter table public.products              enable row level security;
alter table public.orders                enable row level security;
alter table public.order_items           enable row level security;
alter table public.goods_receipts        enable row level security;
alter table public.goods_receipt_items   enable row level security;
alter table public.stock_takes           enable row level security;
alter table public.stock_take_items      enable row level security;
alter table public.shared_barcodes       enable row level security;
alter table public.subscriptions         enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.super_admins          enable row level security;
alter table public.webhook_events        enable row level security;
alter table public.outbox                enable row level security;

-- users: chỉ đọc được chính mình. Đăng nhập/đăng ký đi qua SECURITY DEFINER.
create policy users_select_self on public.users
  for select using (id = public.current_user_id());

-- refresh_tokens, auth_tokens: không policy nào → chỉ server chạm được.

-- organizations
create policy organizations_select on public.organizations
  for select using (
    id in (select public.user_org_ids()) or public.is_super_admin()
  );
-- Sửa thông tin tiệm đi qua RPC update_organization (kiểm tra owner/super_admin).

-- memberships: chỉ thấy dòng của chính mình. Xem thành viên khác dùng RPC
-- get_org_members. Không có policy modify → mọi thay đổi qua RPC.
create policy memberships_select_self on public.memberships
  for select using (user_id = public.current_user_id());

-- categories
create policy categories_select on public.categories
  for select using (org_id in (select public.user_org_ids()));

-- products: CRUD đầy đủ trong phạm vi org
create policy products_select on public.products
  for select using (org_id in (select public.user_org_ids()));
create policy products_modify on public.products
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- orders
create policy orders_select on public.orders
  for select using (org_id in (select public.user_org_ids()));
create policy orders_modify on public.orders
  for all using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

create policy order_items_select on public.order_items
  for select using (
    order_id in (select id from public.orders where org_id in (select public.user_org_ids()))
  );
create policy order_items_modify on public.order_items
  for all using (
    order_id in (select id from public.orders where org_id in (select public.user_org_ids()))
  )
  with check (
    order_id in (select id from public.orders where org_id in (select public.user_org_ids()))
  );

-- goods_receipts / stock_takes: chỉ SELECT, ghi qua RPC
create policy goods_receipts_select on public.goods_receipts
  for select using (org_id in (select public.user_org_ids()));
create policy goods_receipt_items_select on public.goods_receipt_items
  for select using (
    receipt_id in (select id from public.goods_receipts where org_id in (select public.user_org_ids()))
  );

create policy stock_takes_select on public.stock_takes
  for select using (org_id in (select public.user_org_ids()));
create policy stock_take_items_select on public.stock_take_items
  for select using (
    stock_take_id in (select id from public.stock_takes where org_id in (select public.user_org_ids()))
  );

-- shared_barcodes: đọc công khai, ghi qua RPC contribute_barcode
create policy shared_barcodes_read on public.shared_barcodes
  for select using (true);

-- subscriptions
create policy subscriptions_select on public.subscriptions
  for select using (
    public.is_super_admin()
    or exists (
      select 1 from public.memberships
      where memberships.user_id = public.current_user_id()
        and memberships.org_id = subscriptions.org_id
    )
  );

create policy subscription_payments_select on public.subscription_payments
  for select using (
    public.is_super_admin()
    or exists (
      select 1 from public.subscriptions s
      join public.memberships m on m.org_id = s.org_id
      where s.id = subscription_payments.subscription_id
        and m.user_id = public.current_user_id()
    )
  );

create policy super_admins_select on public.super_admins
  for select using (public.is_super_admin());

-- webhook_events, outbox: không policy → chỉ server chạm được.
