-- =============================================================================
-- 0008_goods_receipts.sql — Phase 2A: Nhập kho (goods receipts)
-- =============================================================================
-- Tham chiếu: Phase 2A scope, 4 quyết định chốt:
--   Q1: products.price_buy overwrite với giá nhập mới nhất; lịch sử trong items.
--   Q2: Quét barcode chưa có → UI mở ProductFormModal (handle ở client).
--   Q3: Sidebar "Kho hàng" desktop + button "Nhập kho" mobile (UI).
--   Q4: Defer integration HĐĐT đầu vào — chỉ ghi invoice_no text + total_cost.
--
-- Schema:
--   goods_receipts       — header phiếu nhập, 1 phiếu = 1 lần nhập từ NCC
--   goods_receipt_items  — chi tiết từng dòng (snapshot product_name + price)
--
-- Pattern khớp orders/order_items:
--   - Tiền lưu bigint (đồng VND)
--   - quantity numeric(10,2) cho phép 0.5kg/lít
--   - product_id ON DELETE SET NULL — giữ lịch sử nếu sản phẩm bị xóa
--   - RLS chỉ có SELECT policy; insert/update/delete đi qua RPC security definer
--   - RPC idempotent: cùng receipt id retry → return existing, KHÔNG cộng dồn stock
-- =============================================================================

-- -----------------------------------------------------------------------------
-- goods_receipts — Phiếu nhập kho
-- -----------------------------------------------------------------------------
create table public.goods_receipts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  receiver_id        uuid references auth.users(id) on delete set null,  -- ai nhập
  supplier_name      text,
  supplier_phone     text,
  supplier_tax_code  text,
  receipt_date       date not null default current_date,
  invoice_no         text,                                                -- số HĐ NCC (text, defer integration)
  total_cost         bigint not null default 0,                           -- tổng tiền nhập (đồng)
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index goods_receipts_org_date_idx
  on public.goods_receipts(org_id, receipt_date desc);

create trigger goods_receipts_updated_at
  before update on public.goods_receipts
  for each row execute function extensions.moddatetime('updated_at');

-- -----------------------------------------------------------------------------
-- goods_receipt_items — Chi tiết phiếu nhập (snapshot tại thời điểm nhập)
-- -----------------------------------------------------------------------------
create table public.goods_receipt_items (
  id            uuid primary key default gen_random_uuid(),
  receipt_id    uuid not null references public.goods_receipts(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  product_name  text not null,                  -- snapshot
  unit          text not null,
  quantity      numeric(10,2) not null,
  price_buy     bigint not null,                -- giá nhập đơn vị (đồng)
  line_total    bigint not null                 -- price_buy * quantity (làm tròn đồng)
);

create index goods_receipt_items_receipt_idx on public.goods_receipt_items(receipt_id);
create index goods_receipt_items_product_idx on public.goods_receipt_items(product_id);

-- -----------------------------------------------------------------------------
-- RLS — bật cả 2 tables, chỉ SELECT policy. Modify phải qua RPC.
-- -----------------------------------------------------------------------------
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_items enable row level security;

create policy goods_receipts_select on public.goods_receipts
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

-- items filter qua receipt_id → org_id (subquery, dùng id để gate)
create policy goods_receipt_items_select on public.goods_receipt_items
  for select to authenticated
  using (
    receipt_id in (
      select id from public.goods_receipts
      where org_id in (select public.user_org_ids())
    )
  );

-- -----------------------------------------------------------------------------
-- RPC create_goods_receipt — idempotent insert + stock increment + price_buy overwrite
-- -----------------------------------------------------------------------------
create or replace function public.create_goods_receipt(
  p_receipt jsonb,
  p_items   jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt_id uuid := (p_receipt->>'id')::uuid;
  v_org_id     uuid := (p_receipt->>'org_id')::uuid;
  v_user_id    uuid := auth.uid();
  v_existing   uuid;
  v_item       jsonb;
begin
  -- Auth check
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Authz: user phải thuộc org
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  -- IDEMPOTENT CHECK: receipt đã tồn tại → return luôn (skip insert + stock increment)
  select id into v_existing from public.goods_receipts where id = v_receipt_id;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Insert receipt header
  insert into public.goods_receipts (
    id, org_id, receiver_id, supplier_name, supplier_phone, supplier_tax_code,
    receipt_date, invoice_no, total_cost, notes, created_at
  ) values (
    v_receipt_id,
    v_org_id,
    v_user_id,
    nullif(p_receipt->>'supplier_name', ''),
    nullif(p_receipt->>'supplier_phone', ''),
    nullif(p_receipt->>'supplier_tax_code', ''),
    coalesce((p_receipt->>'receipt_date')::date, current_date),
    nullif(p_receipt->>'invoice_no', ''),
    coalesce((p_receipt->>'total_cost')::bigint, 0),
    nullif(p_receipt->>'notes', ''),
    coalesce((p_receipt->>'created_at')::timestamptz, now())
  );

  -- Insert items + atomic stock increment + price_buy overwrite
  -- (chỉ chạy lần đầu nhờ idempotent check ở trên)
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.goods_receipt_items (
      id, receipt_id, product_id, product_name, unit, quantity, price_buy, line_total
    ) values (
      coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid()),
      v_receipt_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      v_item->>'unit',
      (v_item->>'quantity')::numeric,
      (v_item->>'price_buy')::bigint,
      (v_item->>'line_total')::bigint
    );

    -- Stock increment + price_buy overwrite nếu product_id có
    -- (overwrite price_buy = giá nhập MỚI NHẤT — Q1 đã chốt)
    if (v_item->>'product_id') is not null and (v_item->>'product_id') != '' then
      update public.products
      set
        stock     = stock + (v_item->>'quantity')::numeric,
        price_buy = (v_item->>'price_buy')::bigint
      where id = (v_item->>'product_id')::uuid and org_id = v_org_id;
    end if;
  end loop;

  return v_receipt_id;
end;
$$;

revoke all on function public.create_goods_receipt(jsonb, jsonb) from public;
grant execute on function public.create_goods_receipt(jsonb, jsonb) to authenticated;
