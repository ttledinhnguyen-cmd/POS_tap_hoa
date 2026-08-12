-- =============================================================================
-- 001_pack_supplier_reorder.sql — Quy đổi đơn vị + nhà cung cấp/công nợ + gợi ý đặt hàng
-- =============================================================================
-- Ba khoảng trống thực tế của tiệm tạp hóa mà bản trước chưa có:
--
-- 1. QUY ĐỔI ĐƠN VỊ. Chủ tiệm nhập theo thùng, bán theo lon. Trước đây phải tự
--    nhẩm "1 thùng = 24 lon, 240.000đ chia ra 10.000đ/lon". Nhẩm sai là sai giá
--    vốn, sai lãi, và sai âm thầm.
--
-- 2. CÔNG NỢ NHÀ CUNG CẤP. Gối đầu là chuẩn mực chứ không phải ngoại lệ: NPP
--    giao hàng hôm nay, thu tiền lần ghé sau. Trước đây tên NCC chỉ là chữ tự
--    do trên từng phiếu nên không cộng dồn nợ được.
--
-- 3. GỢI Ý ĐẶT HÀNG. Trước khi NVBH ghé, chủ tiệm cần biết đọc số nào. App có
--    sẵn lịch sử bán, tính ra tốc độ bán là biết còn mấy ngày thì hết.
--
-- Idempotent — chạy lại nhiều lần không hỏng.
-- =============================================================================

SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- 1. Quy đổi đơn vị
-- -----------------------------------------------------------------------------
-- pack_size = số đơn vị bán trong một đơn vị nhập. NULL = nhập và bán cùng đơn
-- vị (gạo, trứng lẻ). Dùng numeric vì có mặt hàng nhập theo kg bán theo lạng.
alter table public.products
  add column if not exists pack_size numeric(10,2)
    check (pack_size is null or pack_size > 0),
  add column if not exists pack_unit text;

comment on column public.products.pack_size is
  'Số đơn vị bán trong 1 đơn vị nhập. VD thùng Coca 24 lon → 24. NULL = không quy đổi.';

-- Giữ lại cách chủ tiệm thực sự gõ vào, không chỉ giữ kết quả đã quy đổi.
-- Khi cần đối chiếu với phiếu giao hàng của NPP thì phải thấy "2 thùng" chứ
-- không phải "48 lon".
alter table public.goods_receipt_items
  add column if not exists pack_qty numeric(10,2),
  add column if not exists pack_size numeric(10,2),
  add column if not exists pack_unit text,
  add column if not exists is_gift boolean not null default false;

comment on column public.goods_receipt_items.is_gift is
  'Hàng tặng kèm (mua 10 tặng 1). Vào kho nhưng KHÔNG ghi đè giá vốn.';

-- -----------------------------------------------------------------------------
-- 2. Nhà cung cấp
-- -----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  phone       text,
  tax_code    text,
  address     text,
  notes       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Không phân biệt hoa thường: "Masan" và "masan" là một nhà cung cấp
create unique index if not exists suppliers_org_name_uniq
  on public.suppliers(org_id, lower(name));
create index if not exists suppliers_org_idx on public.suppliers(org_id);

drop trigger if exists suppliers_updated_at on public.suppliers;
create trigger suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

alter table public.goods_receipts
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists due_date date;

create index if not exists goods_receipts_supplier_idx
  on public.goods_receipts(supplier_id) where supplier_id is not null;

-- Sổ trả tiền cho NCC. CỐ Ý không gắn từng lần trả vào từng phiếu nhập: chủ
-- tiệm trả gộp ("trả anh 5 triệu"), không ai ngồi phân bổ theo phiếu. Công nợ
-- tính theo số dư chạy = tổng nhập − tổng đã trả.
create table if not exists public.supplier_payments (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  supplier_id   uuid not null references public.suppliers(id) on delete cascade,
  amount        bigint not null check (amount > 0),
  payment_date  date not null default current_date,
  method        text not null default 'cash' check (method in ('cash', 'transfer', 'other')),
  notes         text,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists supplier_payments_supplier_idx
  on public.supplier_payments(supplier_id, payment_date desc);

-- -----------------------------------------------------------------------------
-- 3. RLS
-- -----------------------------------------------------------------------------
alter table public.suppliers enable row level security;
alter table public.supplier_payments enable row level security;

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select using (org_id in (select public.user_org_ids()));

drop policy if exists supplier_payments_select on public.supplier_payments;
create policy supplier_payments_select on public.supplier_payments
  for select using (org_id in (select public.user_org_ids()));

-- Không có policy ghi → mọi thay đổi đi qua RPC security definer bên dưới.

grant select, insert, update, delete on public.suppliers to ipos_app;
grant select, insert, update, delete on public.supplier_payments to ipos_app;
