-- =============================================================================
-- 0012_stock_takes.sql — Kiểm kê tồn kho (stock take)
-- =============================================================================
-- Owner đếm thực tế hàng còn lại → so với expected stock (Dexie/DB) → khi
-- commit, products.stock = actual_count. Chênh lệch lưu lại làm audit.
--
-- Khác với goods_receipts (nhập kho cộng dồn stock):
--   - stock_takes ABSOLUTE — set stock = actual (không cộng/trừ delta)
--   - Vẫn lưu delta + delta_value để báo cáo thâm hụt
--
-- Workflow:
--   1. owner click "Kiểm kê mới" → create_stock_take() returns id
--   2. quét/tìm sản phẩm → add_stock_take_item() snapshot expected_stock
--   3. nhập actual_count → update_stock_take_item() (auto-recompute delta)
--   4. owner click "Hoàn tất" → commit_stock_take() apply UPDATE products
--   5. read-only sau khi commit (audit trail)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- stock_takes — header phiếu kiểm kê
-- -----------------------------------------------------------------------------
create table public.stock_takes (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  taker_id            uuid references auth.users(id) on delete set null,
  take_date           date not null default current_date,
  status              text not null default 'in_progress'
                        check (status in ('in_progress', 'committed', 'cancelled')),
  notes               text,
  total_delta_value   bigint not null default 0,  -- âm = thâm hụt (đồng VND)
  total_items_count   int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index stock_takes_org_date_idx on public.stock_takes(org_id, take_date desc);

create trigger stock_takes_updated_at
  before update on public.stock_takes
  for each row execute function extensions.moddatetime('updated_at');

-- -----------------------------------------------------------------------------
-- stock_take_items — chi tiết từng dòng đếm
-- -----------------------------------------------------------------------------
create table public.stock_take_items (
  id              uuid primary key default gen_random_uuid(),
  stock_take_id   uuid not null references public.stock_takes(id) on delete cascade,
  product_id      uuid references public.products(id) on delete set null,
  product_name    text not null,                    -- snapshot
  unit            text not null,
  expected_stock  numeric(10,2) not null,           -- snapshot tại thời điểm add
  actual_count    numeric(10,2) not null default 0,
  delta           numeric(10,2) not null default 0, -- actual - expected (computed app-side)
  reason          text check (reason in ('shrinkage', 'damaged', 'expired', 'found', 'count_error', 'other')),
  unit_cost       bigint not null default 0,        -- snapshot price_buy
  delta_value     bigint not null default 0,        -- delta * unit_cost (đồng)
  created_at      timestamptz not null default now()
);

create index stock_take_items_take_idx on public.stock_take_items(stock_take_id);
create index stock_take_items_product_idx on public.stock_take_items(product_id);

-- -----------------------------------------------------------------------------
-- RLS — bật cả 2 tables, chỉ SELECT policy. Modify đi qua RPC.
-- -----------------------------------------------------------------------------
alter table public.stock_takes enable row level security;
alter table public.stock_take_items enable row level security;

create policy stock_takes_select on public.stock_takes
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

create policy stock_take_items_select on public.stock_take_items
  for select to authenticated
  using (
    stock_take_id in (
      select id from public.stock_takes
      where org_id in (select public.user_org_ids())
    )
  );

-- -----------------------------------------------------------------------------
-- RPCs — security definer, gate qua membership check
-- -----------------------------------------------------------------------------

create or replace function public.create_stock_take(
  p_org_id uuid,
  p_notes  text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated';
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = p_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  insert into public.stock_takes (org_id, taker_id, notes)
  values (p_org_id, v_user_id, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_stock_take(uuid, text) from public;
grant execute on function public.create_stock_take(uuid, text) to authenticated;

-- Helper: recompute parent take totals từ items
create or replace function public.recompute_stock_take_totals(p_take_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stock_takes
  set
    total_items_count = coalesce((
      select count(*) from public.stock_take_items where stock_take_id = p_take_id
    ), 0),
    total_delta_value = coalesce((
      select sum(delta_value) from public.stock_take_items where stock_take_id = p_take_id
    ), 0)
  where id = p_take_id;
end;
$$;

revoke all on function public.recompute_stock_take_totals(uuid) from public;
-- Internal helper, không grant execute cho authenticated (chỉ gọi từ RPCs khác)

-- add_stock_take_item — snapshot expected_stock + price_buy từ products
create or replace function public.add_stock_take_item(
  p_take_id        uuid,
  p_product_id     uuid,
  p_actual_count   numeric,
  p_reason         text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_org_id       uuid;
  v_status       text;
  v_product      record;
  v_delta        numeric;
  v_delta_value  bigint;
  v_item_id      uuid;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated';
  end if;

  select org_id, status into v_org_id, v_status
  from public.stock_takes where id = p_take_id;
  if v_org_id is null then
    raise exception 'Stock take not found';
  end if;
  if v_status != 'in_progress' then
    raise exception 'Stock take is not in_progress (status=%)', v_status;
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  select id, name, unit, stock, price_buy into v_product
  from public.products where id = p_product_id and org_id = v_org_id;
  if v_product.id is null then
    raise exception 'Product not found in this org';
  end if;

  v_delta := p_actual_count - v_product.stock;
  v_delta_value := round(v_delta * v_product.price_buy)::bigint;

  insert into public.stock_take_items (
    stock_take_id, product_id, product_name, unit,
    expected_stock, actual_count, delta, reason, unit_cost, delta_value
  ) values (
    p_take_id, p_product_id, v_product.name, v_product.unit,
    v_product.stock, p_actual_count, v_delta,
    nullif(trim(coalesce(p_reason, '')), ''),
    v_product.price_buy, v_delta_value
  ) returning id into v_item_id;

  perform public.recompute_stock_take_totals(p_take_id);
  return v_item_id;
end;
$$;

revoke all on function public.add_stock_take_item(uuid, uuid, numeric, text) from public;
grant execute on function public.add_stock_take_item(uuid, uuid, numeric, text) to authenticated;

-- update_stock_take_item — recompute delta + delta_value
create or replace function public.update_stock_take_item(
  p_item_id        uuid,
  p_actual_count   numeric,
  p_reason         text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid := auth.uid();
  v_take_id      uuid;
  v_org_id       uuid;
  v_status       text;
  v_expected     numeric;
  v_unit_cost    bigint;
  v_delta        numeric;
  v_delta_value  bigint;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated';
  end if;

  select sti.stock_take_id, sti.expected_stock, sti.unit_cost, st.org_id, st.status
  into v_take_id, v_expected, v_unit_cost, v_org_id, v_status
  from public.stock_take_items sti
  join public.stock_takes st on st.id = sti.stock_take_id
  where sti.id = p_item_id;
  if v_take_id is null then
    raise exception 'Stock take item not found';
  end if;
  if v_status != 'in_progress' then
    raise exception 'Stock take is not in_progress';
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  v_delta := p_actual_count - v_expected;
  v_delta_value := round(v_delta * v_unit_cost)::bigint;

  update public.stock_take_items
  set
    actual_count = p_actual_count,
    delta        = v_delta,
    delta_value  = v_delta_value,
    reason       = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_item_id;

  perform public.recompute_stock_take_totals(v_take_id);
end;
$$;

revoke all on function public.update_stock_take_item(uuid, numeric, text) from public;
grant execute on function public.update_stock_take_item(uuid, numeric, text) to authenticated;

-- remove_stock_take_item — chỉ in_progress
create or replace function public.remove_stock_take_item(
  p_item_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_take_id  uuid;
  v_org_id   uuid;
  v_status   text;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated';
  end if;

  select sti.stock_take_id, st.org_id, st.status
  into v_take_id, v_org_id, v_status
  from public.stock_take_items sti
  join public.stock_takes st on st.id = sti.stock_take_id
  where sti.id = p_item_id;
  if v_take_id is null then
    raise exception 'Stock take item not found';
  end if;
  if v_status != 'in_progress' then
    raise exception 'Stock take is not in_progress';
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  delete from public.stock_take_items where id = p_item_id;
  perform public.recompute_stock_take_totals(v_take_id);
end;
$$;

revoke all on function public.remove_stock_take_item(uuid) from public;
grant execute on function public.remove_stock_take_item(uuid) to authenticated;

-- commit_stock_take — apply UPDATE products SET stock = actual (atomic)
create or replace function public.commit_stock_take(
  p_take_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_org_id   uuid;
  v_status   text;
  v_item     record;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated';
  end if;

  select org_id, status into v_org_id, v_status
  from public.stock_takes where id = p_take_id;
  if v_org_id is null then
    raise exception 'Stock take not found';
  end if;
  if v_status != 'in_progress' then
    raise exception 'Stock take is not in_progress (status=%)', v_status;
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  -- Apply: SET stock = actual_count cho từng item có product_id
  for v_item in
    select product_id, actual_count
    from public.stock_take_items
    where stock_take_id = p_take_id and product_id is not null
  loop
    update public.products
    set stock = v_item.actual_count
    where id = v_item.product_id and org_id = v_org_id;
  end loop;

  -- Mark committed
  update public.stock_takes
  set status = 'committed'
  where id = p_take_id;
end;
$$;

revoke all on function public.commit_stock_take(uuid) from public;
grant execute on function public.commit_stock_take(uuid) to authenticated;

-- cancel_stock_take — set cancelled, giữ items audit trail
create or replace function public.cancel_stock_take(
  p_take_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_org_id   uuid;
  v_status   text;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated';
  end if;

  select org_id, status into v_org_id, v_status
  from public.stock_takes where id = p_take_id;
  if v_org_id is null then
    raise exception 'Stock take not found';
  end if;
  if v_status != 'in_progress' then
    raise exception 'Stock take is not in_progress';
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  update public.stock_takes set status = 'cancelled' where id = p_take_id;
end;
$$;

revoke all on function public.cancel_stock_take(uuid) from public;
grant execute on function public.cancel_stock_take(uuid) to authenticated;

-- Realtime: bật cho stock_takes (header). Items pull on demand.
alter publication supabase_realtime add table public.stock_takes;
