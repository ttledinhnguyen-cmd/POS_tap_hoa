-- =============================================================================
-- 0003_fixes.sql — Schema corrections từ review session 2026-04-30
-- =============================================================================
-- Fix list:
--   1. products: unique (org_id, barcode) tránh trùng EAN-13 trong cùng tiệm
--   2. products + order_items: tax_rate check (0|5|8|10)
--   3. orders: thêm updated_at + trigger (cần cho audit invoice_status)
--   4. orders: invoice_no unique trong org (idempotent issue invoice)
--   5. RPC create_organization() — fix onboarding deadlock RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. products: unique (org_id, barcode) khi barcode != null
-- Cho phép nhiều product không có barcode (sản phẩm tự đặt) cùng tồn tại,
-- nhưng cấm 2 product trùng EAN-13 trong cùng 1 tiệm.
-- -----------------------------------------------------------------------------
create unique index if not exists products_org_barcode_unique
  on public.products(org_id, barcode)
  where barcode is not null;

-- -----------------------------------------------------------------------------
-- 2. tax_rate check constraint
-- -----------------------------------------------------------------------------
alter table public.products
  add constraint products_tax_rate_check
  check (tax_rate in (0, 5, 8, 10));

alter table public.order_items
  add constraint order_items_tax_rate_check
  check (tax_rate in (0, 5, 8, 10));

-- -----------------------------------------------------------------------------
-- 3. orders.updated_at + trigger
-- Cần biết thời điểm invoice_status đổi (none → pending → issued)
-- -----------------------------------------------------------------------------
alter table public.orders
  add column updated_at timestamptz not null default now();

create trigger orders_updated_at
  before update on public.orders
  for each row execute function extensions.moddatetime('updated_at');

-- -----------------------------------------------------------------------------
-- 4. orders.invoice_no unique trong org (khi không null)
-- Đảm bảo idempotent issue invoice — retry không tạo HĐĐT trùng số.
-- -----------------------------------------------------------------------------
create unique index if not exists orders_org_invoice_no_unique
  on public.orders(org_id, invoice_no)
  where invoice_no is not null;

-- -----------------------------------------------------------------------------
-- 5. RPC create_organization — fix onboarding deadlock
-- User mới signup chưa thuộc org nào nên không thể self-insert membership
-- (vì memberships_modify_owner đòi user phải đã là owner). Function
-- security definer này tạo org + membership owner trong 1 transaction.
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(
  p_name      text,
  p_tax_code  text default null,
  p_address   text default null,
  p_phone     text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id  uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Organization name is required';
  end if;

  insert into public.organizations (name, tax_code, address, phone)
  values (
    btrim(p_name),
    nullif(btrim(p_tax_code), ''),
    nullif(btrim(p_address), ''),
    nullif(btrim(p_phone), '')
  )
  returning id into v_org_id;

  insert into public.memberships (user_id, org_id, role)
  values (v_user_id, v_org_id, 'owner');

  return v_org_id;
end;
$$;

revoke all on function public.create_organization(text, text, text, text) from public;
grant execute on function public.create_organization(text, text, text, text) to authenticated;

-- =============================================================================
-- SMOKE TEST sau khi push (chạy trong Supabase SQL Editor)
-- =============================================================================
-- A. Verify schema:
--    select indexname from pg_indexes where tablename='products' and indexname='products_org_barcode_unique';
--    select indexname from pg_indexes where tablename='orders' and indexname='orders_org_invoice_no_unique';
--    select column_name from information_schema.columns where table_name='orders' and column_name='updated_at';
--    select proname from pg_proc where proname='create_organization';
--    -- 4 query trên phải trả về 1 dòng mỗi cái.
--
-- B. Test unique barcode (chạy dạng 1 transaction để rollback an toàn):
--    begin;
--    insert into organizations(name) values ('Smoke Test') returning id;
--    -- Lấy UUID, insert 2 products cùng barcode → row 2 phải FAIL:
--    insert into products(org_id, name, barcode, price_sell, stock)
--      values ('<UUID>', 'Test 1', '1111111111111', 1000, 1);
--    insert into products(org_id, name, barcode, price_sell, stock)
--      values ('<UUID>', 'Test 2', '1111111111111', 2000, 1);
--    -- Câu 2 phải lỗi: duplicate key value violates unique constraint
--    rollback;
--
-- C. Test tax_rate check:
--    -- Phải FAIL với "violates check constraint":
--    insert into products(org_id, name, price_sell, stock, tax_rate)
--      values ('<UUID>', 'Test', 0, 0, 7);
--
-- D. Test orders.updated_at trigger:
--    begin;
--    insert into organizations(name) values ('Test') returning id;
--    insert into orders(org_id, subtotal, total, payment_method)
--      values ('<UUID>', 1000, 1000, 'cash')
--      returning id, created_at, updated_at;
--    -- updated_at = created_at lúc này
--    -- pg_sleep 1 giây cho timestamp khác:
--    select pg_sleep(1);
--    update orders set notes='test' where id='<order_id>'
--      returning updated_at;
--    -- updated_at phải MỚI HƠN created_at
--    rollback;
-- =============================================================================
