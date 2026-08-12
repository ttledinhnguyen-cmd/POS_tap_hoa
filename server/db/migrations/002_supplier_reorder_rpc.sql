-- =============================================================================
-- 002_supplier_reorder_rpc.sql — RPC cho nhà cung cấp, công nợ, gợi ý đặt hàng
-- =============================================================================
SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Nhà cung cấp
-- -----------------------------------------------------------------------------
create or replace function public.upsert_supplier(
  p_org_id   uuid,
  p_name     text,
  p_id       uuid default null,
  p_phone    text default null,
  p_tax_code text default null,
  p_address  text default null,
  p_notes    text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_user_id();
  v_id      uuid;
  v_clean   text := btrim(coalesce(p_name, ''));
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;
  if v_clean = '' then raise exception 'Tên nhà cung cấp không được để trống'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = p_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  if p_id is not null then
    update public.suppliers
    set name = v_clean,
        phone = nullif(btrim(coalesce(p_phone, '')), ''),
        tax_code = nullif(btrim(coalesce(p_tax_code, '')), ''),
        address = nullif(btrim(coalesce(p_address, '')), ''),
        notes = nullif(btrim(coalesce(p_notes, '')), '')
    where id = p_id and org_id = p_org_id
    returning id into v_id;
    if v_id is null then raise exception 'Không tìm thấy nhà cung cấp'; end if;
    return v_id;
  end if;

  -- Trùng tên thì trả về cái đang có. Chủ tiệm gõ tay tên NCC mỗi lần nhập
  -- hàng, bắt họ nhớ đã tạo hay chưa là vô lý.
  select id into v_id from public.suppliers
  where org_id = p_org_id and lower(name) = lower(v_clean);
  if v_id is not null then return v_id; end if;

  insert into public.suppliers (org_id, name, phone, tax_code, address, notes)
  values (
    p_org_id, v_clean,
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_tax_code, '')), ''),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.archive_supplier(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select org_id into v_org_id from public.suppliers where id = p_id;
  if v_org_id is null then raise exception 'Không tìm thấy nhà cung cấp'; end if;
  if not exists (
    select 1 from public.memberships
    where user_id = public.current_user_id() and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;
  -- Ẩn chứ không xoá: phiếu nhập cũ vẫn phải tra ra được tên NCC
  update public.suppliers set is_active = false where id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Công nợ
-- -----------------------------------------------------------------------------
create or replace function public.record_supplier_payment(
  p_supplier_id uuid,
  p_amount      bigint,
  p_method      text default 'cash',
  p_notes       text default null,
  p_date        date default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_user_id();
  v_org_id  uuid;
  v_id      uuid;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Số tiền phải lớn hơn 0';
  end if;

  select org_id into v_org_id from public.suppliers where id = p_supplier_id;
  if v_org_id is null then raise exception 'Không tìm thấy nhà cung cấp'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  insert into public.supplier_payments (org_id, supplier_id, amount, method, notes, payment_date, created_by)
  values (v_org_id, p_supplier_id, p_amount, p_method,
          nullif(btrim(coalesce(p_notes, '')), ''),
          coalesce(p_date, current_date), v_user_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Số dư công nợ theo từng NCC: tổng nhập trừ tổng đã trả.
-- Dương = mình còn nợ họ. Âm = trả dư (ứng trước).
create or replace function public.supplier_debt(p_org_id uuid)
returns table (
  supplier_id      uuid,
  supplier_name    text,
  phone            text,
  total_purchased  bigint,
  total_paid       bigint,
  balance          bigint,
  last_purchase_at date,
  receipts_count   int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.memberships
    where user_id = public.current_user_id() and org_id = p_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  return query
  select
    s.id,
    s.name,
    s.phone,
    coalesce(g.total, 0)::bigint,
    coalesce(p.total, 0)::bigint,
    (coalesce(g.total, 0) - coalesce(p.total, 0))::bigint,
    g.last_date,
    coalesce(g.cnt, 0)::int
  from public.suppliers s
  left join lateral (
    select sum(total_cost) as total, max(receipt_date) as last_date, count(*) as cnt
    from public.goods_receipts gr where gr.supplier_id = s.id
  ) g on true
  left join lateral (
    select sum(amount) as total
    from public.supplier_payments sp where sp.supplier_id = s.id
  ) p on true
  where s.org_id = p_org_id and s.is_active
  order by (coalesce(g.total, 0) - coalesce(p.total, 0)) desc, s.name;
end;
$$;

-- -----------------------------------------------------------------------------
-- Gợi ý đặt hàng
-- -----------------------------------------------------------------------------
-- Tính tốc độ bán từ lịch sử rồi suy ra còn mấy ngày thì hết hàng.
--
-- Chia cho số ngày SẢN PHẨM ĐÓ THỰC SỰ CÓ BÁN chứ không chia cho cả cửa sổ:
-- hàng mới nhập 3 ngày trước mà chia cho 14 ngày sẽ ra tốc độ thấp giả tạo,
-- rồi app bảo "còn 40 ngày nữa mới hết" trong khi mai đã cháy hàng.
--
-- p_days     : cửa sổ lịch sử để tính tốc độ
-- p_horizon  : muốn hàng đủ bán bao nhiêu ngày tới
create or replace function public.suggest_reorder(
  p_org_id  uuid,
  p_days    int default 14,
  p_horizon int default 7
) returns table (
  product_id    uuid,
  name          text,
  unit          text,
  category      text,
  stock         numeric,
  sold_total    numeric,
  sold_per_day  numeric,
  days_left     numeric,
  suggest_qty   numeric,
  pack_size     numeric,
  pack_unit     text,
  suggest_packs numeric,
  price_buy     bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.memberships
    where user_id = public.current_user_id() and org_id = p_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  return query
  with sales as (
    select
      oi.product_id,
      sum(oi.quantity) as qty,
      -- Số ngày riêng biệt có phát sinh bán, tối thiểu 1 để khỏi chia cho 0
      greatest(count(distinct o.created_at::date), 1) as active_days
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.org_id = p_org_id
      and o.created_at >= now() - (p_days || ' days')::interval
      and oi.product_id is not null
    group by oi.product_id
  )
  select
    p.id,
    p.name,
    p.unit,
    p.category,
    p.stock,
    coalesce(s.qty, 0),
    round(coalesce(s.qty, 0) / s.active_days, 2),
    case
      when coalesce(s.qty, 0) = 0 then null
      else round(p.stock / (s.qty / s.active_days), 1)
    end,
    -- Cần đủ bán p_horizon ngày, trừ đi tồn hiện có. Làm tròn LÊN vì không ai
    -- đặt nửa gói.
    greatest(ceil((s.qty / s.active_days) * p_horizon - p.stock), 0),
    p.pack_size,
    p.pack_unit,
    case
      when p.pack_size is null or p.pack_size <= 0 then null
      else ceil(greatest((s.qty / s.active_days) * p_horizon - p.stock, 0) / p.pack_size)
    end,
    p.price_buy
  from public.products p
  join sales s on s.product_id = p.id
  where p.org_id = p_org_id
    and p.is_active
    -- Chỉ liệt kê hàng sắp hết: tồn không đủ bán hết p_horizon ngày
    and p.stock < (s.qty / s.active_days) * p_horizon
  order by (p.stock / nullif(s.qty / s.active_days, 0)) asc nulls last;
end;
$$;

-- -----------------------------------------------------------------------------
-- Quyền
-- -----------------------------------------------------------------------------
revoke all on function public.upsert_supplier(uuid, text, uuid, text, text, text, text) from public;
revoke all on function public.archive_supplier(uuid) from public;
revoke all on function public.record_supplier_payment(uuid, bigint, text, text, date) from public;
revoke all on function public.supplier_debt(uuid) from public;
revoke all on function public.suggest_reorder(uuid, int, int) from public;

grant execute on function public.upsert_supplier(uuid, text, uuid, text, text, text, text) to ipos_app;
grant execute on function public.archive_supplier(uuid) to ipos_app;
grant execute on function public.record_supplier_payment(uuid, bigint, text, text, date) to ipos_app;
grant execute on function public.supplier_debt(uuid) to ipos_app;
grant execute on function public.suggest_reorder(uuid, int, int) to ipos_app;
