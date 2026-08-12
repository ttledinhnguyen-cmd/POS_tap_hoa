-- =============================================================================
-- 005_returns_and_visits.sql — Xuất trả nhà cung cấp + lịch NVBH ghé
-- =============================================================================
-- 1. XUẤT TRẢ. Hàng cận date, hàng lỗi, hàng bán không chạy đều được trả lại
--    NPP để trừ vào công nợ. Không có đường này thì chủ tiệm phải tự nhớ, và
--    tồn kho trên máy cao hơn thực tế.
--
-- 2. LỊCH NVBH. NPP đi theo tuyến cố định: thứ Ba anh Vinamilk, thứ Năm chị
--    Unilever. Biết hôm nay ai ghé thì chủ tiệm chuẩn bị số trước, khỏi bị hỏi
--    bất ngờ rồi đặt thiếu.
SET client_encoding = 'UTF8';

-- -----------------------------------------------------------------------------
-- Lịch ghé
-- -----------------------------------------------------------------------------
-- Mảng thứ trong tuần theo quy ước ISO của Postgres: 1=Thứ Hai … 7=Chủ Nhật.
-- Dùng ISO chứ không dùng 0=CN để khớp thẳng extract(isodow) khi truy vấn.
alter table public.suppliers
  add column if not exists visit_weekdays smallint[],
  add column if not exists sales_rep_name text,
  add column if not exists sales_rep_phone text;

comment on column public.suppliers.visit_weekdays is
  'Thứ NVBH ghé, theo ISO: 1=T2 … 7=CN. NULL = không có lịch cố định.';

-- -----------------------------------------------------------------------------
-- Xuất trả
-- -----------------------------------------------------------------------------
create table if not exists public.goods_returns (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  supplier_id  uuid references public.suppliers(id) on delete set null,
  return_date  date not null default current_date,
  total_value  bigint not null default 0,
  reason       text check (reason in ('expired', 'damaged', 'slow_moving', 'wrong_item', 'other')),
  notes        text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists goods_returns_org_date_idx
  on public.goods_returns(org_id, return_date desc);
create index if not exists goods_returns_supplier_idx
  on public.goods_returns(supplier_id) where supplier_id is not null;

drop trigger if exists goods_returns_updated_at on public.goods_returns;
create trigger goods_returns_updated_at
  before update on public.goods_returns
  for each row execute function public.set_updated_at();

create table if not exists public.goods_return_items (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references public.goods_returns(id) on delete cascade,
  product_id   uuid references public.products(id) on delete set null,
  product_name text not null,
  unit         text not null,
  quantity     numeric(10,2) not null check (quantity > 0),
  price_buy    bigint not null,
  line_total   bigint not null
);

create index if not exists goods_return_items_return_idx
  on public.goods_return_items(return_id);

alter table public.goods_returns enable row level security;
alter table public.goods_return_items enable row level security;

drop policy if exists goods_returns_select on public.goods_returns;
create policy goods_returns_select on public.goods_returns
  for select using (org_id in (select public.user_org_ids()));

drop policy if exists goods_return_items_select on public.goods_return_items;
create policy goods_return_items_select on public.goods_return_items
  for select using (
    return_id in (
      select id from public.goods_returns where org_id in (select public.user_org_ids())
    )
  );

grant select, insert, update, delete on public.goods_returns to ipos_app;
grant select, insert, update, delete on public.goods_return_items to ipos_app;

-- -----------------------------------------------------------------------------
-- RPC tạo phiếu trả
-- -----------------------------------------------------------------------------
-- Idempotent qua id do client sinh, giống create_goods_receipt: outbox retry
-- khi mạng chập chờn không được trừ kho hai lần.
--
-- Giá dùng để tính giá trị trả là GIÁ VỐN HIỆN TẠI của sản phẩm, không phải giá
-- bán — trả hàng là hoàn lại tiền đã bỏ ra mua, không phải doanh thu.
create or replace function public.create_goods_return(
  p_return jsonb,
  p_items  jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_return_id uuid := (p_return->>'id')::uuid;
  v_org_id    uuid := (p_return->>'org_id')::uuid;
  v_user_id   uuid := public.current_user_id();
  v_supplier  uuid := nullif(p_return->>'supplier_id', '')::uuid;
  v_existing  uuid;
  v_item      jsonb;
  v_qty       numeric;
  v_price     bigint;
  v_total     bigint := 0;
begin
  if v_user_id is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;
  if v_supplier is not null and not exists (
    select 1 from public.suppliers where id = v_supplier and org_id = v_org_id
  ) then
    raise exception 'Nhà cung cấp không thuộc tiệm này';
  end if;

  select id into v_existing from public.goods_returns where id = v_return_id;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.goods_returns (
    id, org_id, supplier_id, return_date, reason, notes, created_by, created_at
  ) values (
    v_return_id, v_org_id, v_supplier,
    coalesce((p_return->>'return_date')::date, current_date),
    nullif(p_return->>'reason', ''),
    nullif(p_return->>'notes', ''),
    v_user_id,
    coalesce((p_return->>'created_at')::timestamptz, now())
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      continue;
    end if;

    -- Lấy giá vốn hiện tại từ sản phẩm, không tin giá client gửi
    select price_buy into v_price
    from public.products
    where id = nullif(v_item->>'product_id', '')::uuid and org_id = v_org_id;
    v_price := coalesce(v_price, (v_item->>'price_buy')::bigint, 0);

    insert into public.goods_return_items (
      return_id, product_id, product_name, unit, quantity, price_buy, line_total
    ) values (
      v_return_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      v_item->>'unit',
      v_qty,
      v_price,
      round(v_price * v_qty)::bigint
    );

    v_total := v_total + round(v_price * v_qty)::bigint;

    -- Trừ kho. Cho phép âm giống lúc bán: số liệu lệch thì chủ tiệm kiểm kê
    -- lại, chặn ở đây chỉ khiến họ không ghi được việc đã xảy ra thật.
    if nullif(v_item->>'product_id', '') is not null then
      update public.products
      set stock = stock - v_qty
      where id = (v_item->>'product_id')::uuid and org_id = v_org_id;
    end if;
  end loop;

  update public.goods_returns set total_value = v_total where id = v_return_id;
  return v_return_id;
end;
$$;

revoke all on function public.create_goods_return(jsonb, jsonb) from public;
grant execute on function public.create_goods_return(jsonb, jsonb) to ipos_app;

-- -----------------------------------------------------------------------------
-- Công nợ có tính hàng trả
-- -----------------------------------------------------------------------------
-- Trả hàng làm GIẢM số mình nợ NPP. Không trừ ở đây thì chủ tiệm trả hàng xong
-- vẫn thấy nợ nguyên, rồi trả dư tiền.
-- Đổi danh sách cột trả về nên phải DROP trước: Postgres không cho
--  khi kiểu trả về thay đổi.
drop function if exists public.supplier_debt(uuid);
create function public.supplier_debt(p_org_id uuid)
returns table (
  supplier_id      uuid,
  supplier_name    text,
  phone            text,
  total_purchased  bigint,
  total_paid       bigint,
  total_returned   bigint,
  balance          bigint,
  last_purchase_at date,
  receipts_count   int,
  visit_weekdays   smallint[],
  sales_rep_name   text,
  sales_rep_phone  text
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
    s.id, s.name, s.phone,
    coalesce(g.total, 0)::bigint,
    coalesce(p.total, 0)::bigint,
    coalesce(r.total, 0)::bigint,
    (coalesce(g.total, 0) - coalesce(p.total, 0) - coalesce(r.total, 0))::bigint,
    g.last_date,
    coalesce(g.cnt, 0)::int,
    s.visit_weekdays,
    s.sales_rep_name,
    s.sales_rep_phone
  from public.suppliers s
  left join lateral (
    select sum(total_cost) as total, max(receipt_date) as last_date, count(*) as cnt
    from public.goods_receipts gr where gr.supplier_id = s.id
  ) g on true
  left join lateral (
    select sum(amount) as total
    from public.supplier_payments sp where sp.supplier_id = s.id
  ) p on true
  left join lateral (
    select sum(total_value) as total
    from public.goods_returns gr2 where gr2.supplier_id = s.id
  ) r on true
  where s.org_id = p_org_id and s.is_active
  order by
    (coalesce(g.total, 0) - coalesce(p.total, 0) - coalesce(r.total, 0)) desc,
    s.name;
end;
$$;

revoke all on function public.supplier_debt(uuid) from public;
grant execute on function public.supplier_debt(uuid) to ipos_app;

-- -----------------------------------------------------------------------------
-- Đặt lịch NVBH ghé
-- -----------------------------------------------------------------------------
create or replace function public.set_supplier_schedule(
  p_supplier_id uuid,
  p_weekdays    smallint[],
  p_rep_name    text default null,
  p_rep_phone   text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_day    smallint;
begin
  select org_id into v_org_id from public.suppliers where id = p_supplier_id;
  if v_org_id is null then raise exception 'Không tìm thấy nhà cung cấp'; end if;
  if not exists (
    select 1 from public.memberships
    where user_id = public.current_user_id() and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  if p_weekdays is not null then
    foreach v_day in array p_weekdays loop
      if v_day < 1 or v_day > 7 then
        raise exception 'Thứ không hợp lệ: % (phải từ 1=T2 đến 7=CN)', v_day;
      end if;
    end loop;
  end if;

  update public.suppliers
  set visit_weekdays  = nullif(p_weekdays, '{}'),
      sales_rep_name  = nullif(btrim(coalesce(p_rep_name, '')), ''),
      sales_rep_phone = nullif(btrim(coalesce(p_rep_phone, '')), '')
  where id = p_supplier_id;
end;
$$;

revoke all on function public.set_supplier_schedule(uuid, smallint[], text, text) from public;
grant execute on function public.set_supplier_schedule(uuid, smallint[], text, text) to ipos_app;
