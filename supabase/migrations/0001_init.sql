-- =============================================================================
-- 0001_init.sql — Schema cốt lõi POS Tạp Hóa
-- =============================================================================
-- Tham chiếu: docs/API_INTEGRATION_SPEC.md section 1.1
--
-- Quy tắc:
--   - Tiền lưu bigint (đồng VND), KHÔNG decimal/float
--   - stock numeric(10,2) cho phép bán lẻ 0.5kg
--   - tax_rate mặc định 8% (NQ 204/2025/QH15 đến hết 2026, sau đó 10%)
--   - Mọi FK trỏ sang user/product/order dùng ON DELETE SET NULL
--     để giữ lịch sử (order_items đã snapshot product_name + price)
-- =============================================================================

-- Extensions cần cho gen_random_uuid() và moddatetime trigger
create extension if not exists "pgcrypto";
create extension if not exists "moddatetime" schema extensions;

-- -----------------------------------------------------------------------------
-- organizations — Mỗi tiệm = 1 row
-- -----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tax_code    text,                  -- MST tiệm (nếu có)
  address     text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function extensions.moddatetime('updated_at');

-- -----------------------------------------------------------------------------
-- memberships — User × Organization × Role
-- 1 user có thể thuộc nhiều tiệm (multi-store về sau)
-- -----------------------------------------------------------------------------
create table public.memberships (
  user_id     uuid not null references auth.users(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  role        text not null check (role in ('owner', 'cashier')),
  created_at  timestamptz not null default now(),
  primary key (user_id, org_id)
);

create index memberships_org_idx on public.memberships(org_id);

-- -----------------------------------------------------------------------------
-- products — Sản phẩm (per-org)
-- -----------------------------------------------------------------------------
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  barcode      text,                       -- EAN-13/UPC, có thể null cho sản phẩm tự đặt
  name         text not null,
  unit         text not null default 'cái',
  price_buy    bigint not null default 0,  -- giá vốn (đồng), chỉ owner thấy
  price_sell   bigint not null default 0,  -- giá bán đã bao gồm thuế (đồng)
  stock        numeric(10,2) not null default 0,
  tax_rate     numeric(4,2) not null default 8,  -- 0 | 5 | 8 | 10
  category     text,
  image_url    text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index products_org_barcode_idx on public.products(org_id, barcode);
create index products_org_name_idx on public.products(org_id, name text_pattern_ops);

create trigger products_updated_at
  before update on public.products
  for each row execute function extensions.moddatetime('updated_at');

-- -----------------------------------------------------------------------------
-- orders — Đơn hàng
-- -----------------------------------------------------------------------------
create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,
  cashier_id            uuid references auth.users(id) on delete set null,
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
  invoice_no            text,    -- số HĐĐT do nhà cung cấp cấp
  invoice_lookup_code   text,    -- mã tra cứu trên tracuuhoadon.gdt.gov.vn
  invoice_xml_url       text,
  invoice_pdf_url       text,
  notes                 text,
  created_at            timestamptz not null default now()
);

create index orders_org_created_idx on public.orders(org_id, created_at desc);
create index orders_invoice_status_idx on public.orders(invoice_status) where invoice_status in ('pending', 'failed');

-- -----------------------------------------------------------------------------
-- order_items — Chi tiết đơn (snapshot tại thời điểm bán)
-- -----------------------------------------------------------------------------
create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  product_name  text not null,                    -- snapshot
  unit          text not null,
  quantity      numeric(10,2) not null,
  price_buy     bigint not null,                  -- snapshot giá vốn
  price_sell    bigint not null,                  -- snapshot giá bán
  tax_rate      numeric(4,2) not null default 8,
  line_total    bigint not null                   -- price_sell * quantity (làm tròn đồng)
);

create index order_items_order_idx on public.order_items(order_id);

-- -----------------------------------------------------------------------------
-- webhook_events — Audit log raw payload từ SePay/MISA/Zalo
-- -----------------------------------------------------------------------------
create table public.webhook_events (
  id               uuid primary key default gen_random_uuid(),
  source           text not null,    -- 'sepay' | 'misa' | 'zalo'
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

-- -----------------------------------------------------------------------------
-- outbox — Internal job queue (server-side, drain bởi Edge Functions)
-- -----------------------------------------------------------------------------
create table public.outbox (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  type         text not null,    -- 'invoice.issue' | 'order.sync' | 'zns.send' | ...
  payload      jsonb not null,
  status       text not null default 'pending'
                 check (status in ('pending', 'done', 'failed')),
  attempts     int not null default 0,
  last_error   text,
  next_run_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index outbox_pending_idx
  on public.outbox(status, next_run_at)
  where status = 'pending';
