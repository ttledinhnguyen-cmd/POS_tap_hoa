-- =============================================================================
-- functions.sql — RPC port từ Supabase sang PostgreSQL thuần
-- =============================================================================
-- Mọi function SECURITY DEFINER, sở hữu bởi ipos_owner, nên chạy bỏ qua RLS.
-- Đây là cách client ghi vào bảng mà policy RLS chặn ghi trực tiếp.
--
-- Thay đổi so với bản Supabase:
--   auth.uid()   → public.current_user_id()
--   auth.users   → public.users
--   grant ... to authenticated → grant ... to ipos_app
--
-- MỌI function đều tự kiểm tra quyền. Đừng bỏ phần kiểm tra khi sửa: SECURITY
-- DEFINER bỏ qua RLS nên đó là hàng phòng thủ duy nhất còn lại.
--
-- File này idempotent (create or replace), chạy lại bao nhiêu lần cũng được.
-- =============================================================================

-- =============================================================================
-- Onboarding
-- =============================================================================
-- User mới chưa thuộc org nào nên không tự insert membership được (policy đòi
-- đã là owner). Function này tạo org + membership owner trong cùng transaction.
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
  v_user_id uuid := public.current_user_id();
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

create or replace function public.get_org_members(p_org_id uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_user_id();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.user_id = v_user_id and m.org_id = p_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;
  return query
    select m.user_id, u.email, m.role, m.created_at
    from public.memberships m
    join public.users u on u.id = m.user_id
    where m.org_id = p_org_id
    order by m.created_at asc;
end;
$$;

-- =============================================================================
-- Bán hàng
-- =============================================================================
-- Idempotent qua order.id do client sinh: retry cùng id → return luôn, KHÔNG
-- insert items lại, KHÔNG trừ kho lần hai. Đây là điều kiện sống còn cho
-- outbox worker vì nó retry theo backoff khi mạng chập chờn.
--
-- Kho cho phép âm: bán nợ là chuyện bình thường ở tạp hóa.
create or replace function public.create_order_with_items(
  p_order jsonb,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid := (p_order->>'id')::uuid;
  v_org_id   uuid := (p_order->>'org_id')::uuid;
  v_user_id  uuid := public.current_user_id();
  v_existing uuid;
  v_item     jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  select id into v_existing from public.orders where id = v_order_id;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.orders (
    id, org_id, cashier_id, subtotal, tax_amount, discount, total,
    payment_method, cash_received, change_amount, customer_name,
    customer_phone, customer_tax_code, notes, created_at
  ) values (
    v_order_id, v_org_id, v_user_id,
    (p_order->>'subtotal')::bigint,
    coalesce((p_order->>'tax_amount')::bigint, 0),
    coalesce((p_order->>'discount')::bigint, 0),
    (p_order->>'total')::bigint,
    p_order->>'payment_method',
    nullif(p_order->>'cash_received', '')::bigint,
    nullif(p_order->>'change_amount', '')::bigint,
    nullif(p_order->>'customer_name', ''),
    nullif(p_order->>'customer_phone', ''),
    nullif(p_order->>'customer_tax_code', ''),
    nullif(p_order->>'notes', ''),
    coalesce((p_order->>'created_at')::timestamptz, now())
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.order_items (
      id, order_id, product_id, product_name, unit, quantity,
      price_buy, price_sell, tax_rate, line_total
    ) values (
      coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid()),
      v_order_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      v_item->>'unit',
      (v_item->>'quantity')::numeric,
      (v_item->>'price_buy')::bigint,
      (v_item->>'price_sell')::bigint,
      (v_item->>'tax_rate')::numeric,
      (v_item->>'line_total')::bigint
    );

    if nullif(v_item->>'product_id', '') is not null then
      update public.products
      set stock = stock - (v_item->>'quantity')::numeric
      where id = (v_item->>'product_id')::uuid and org_id = v_org_id;
    end if;
  end loop;

  return v_order_id;
end;
$$;

-- =============================================================================
-- Nhập kho
-- =============================================================================
-- price_buy bị ghi đè bằng giá nhập mới nhất (quyết định Q1 của Phase 2A);
-- lịch sử giá nằm ở goods_receipt_items.
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
  v_user_id    uuid := public.current_user_id();
  v_existing   uuid;
  v_item       jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  select id into v_existing from public.goods_receipts where id = v_receipt_id;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.goods_receipts (
    id, org_id, receiver_id, supplier_name, supplier_phone, supplier_tax_code,
    receipt_date, invoice_no, total_cost, notes, created_at
  ) values (
    v_receipt_id, v_org_id, v_user_id,
    nullif(p_receipt->>'supplier_name', ''),
    nullif(p_receipt->>'supplier_phone', ''),
    nullif(p_receipt->>'supplier_tax_code', ''),
    coalesce((p_receipt->>'receipt_date')::date, current_date),
    nullif(p_receipt->>'invoice_no', ''),
    coalesce((p_receipt->>'total_cost')::bigint, 0),
    nullif(p_receipt->>'notes', ''),
    coalesce((p_receipt->>'created_at')::timestamptz, now())
  );

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

    if nullif(v_item->>'product_id', '') is not null then
      update public.products
      set stock     = stock + (v_item->>'quantity')::numeric,
          price_buy = (v_item->>'price_buy')::bigint
      where id = (v_item->>'product_id')::uuid and org_id = v_org_id;
    end if;
  end loop;

  return v_receipt_id;
end;
$$;

-- =============================================================================
-- Danh mục
-- =============================================================================
-- products.category cố ý là TEXT chứ không FK: giữ được snapshot khi đổi tên,
-- và cho phép gõ danh mục mới ngay trong form sản phẩm.
create or replace function public.create_category(p_org_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := public.current_user_id();
  v_id       uuid;
  v_clean    text := trim(coalesce(p_name, ''));
  v_next_ord int;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;
  if v_clean = '' then raise exception 'Name required'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = p_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  select id into v_id from public.categories where org_id = p_org_id and name = v_clean;
  if v_id is not null then return v_id; end if;

  select coalesce(max(display_order), 0) + 1 into v_next_ord
  from public.categories where org_id = p_org_id;

  insert into public.categories (org_id, name, display_order)
  values (p_org_id, v_clean, v_next_ord)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_category(
  p_id        uuid,
  p_new_name  text default null,
  p_new_order int default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := public.current_user_id();
  v_org_id   uuid;
  v_old_name text;
  v_clean    text;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;

  select org_id, name into v_org_id, v_old_name from public.categories where id = p_id;
  if v_org_id is null then raise exception 'Category not found'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  if p_new_name is not null then
    v_clean := trim(p_new_name);
    if v_clean = '' then raise exception 'New name cannot be empty'; end if;
    if v_clean != v_old_name then
      if exists (
        select 1 from public.categories
        where org_id = v_org_id and name = v_clean and id != p_id
      ) then
        raise exception 'Category name already exists in this org';
      end if;
      -- Cascade sang products vì category là text snapshot, không FK
      update public.products set category = v_clean
      where org_id = v_org_id and category = v_old_name;
      update public.categories set name = v_clean where id = p_id;
    end if;
  end if;

  if p_new_order is not null then
    update public.categories set display_order = p_new_order where id = p_id;
  end if;
end;
$$;

create or replace function public.delete_category(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_user_id();
  v_org_id  uuid;
  v_name    text;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;

  select org_id, name into v_org_id, v_name from public.categories where id = p_id;
  if v_org_id is null then raise exception 'Category not found'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  -- Sản phẩm mồ côi rơi vào nhóm "Khác" ở UI
  update public.products set category = null
  where org_id = v_org_id and category = v_name;

  delete from public.categories where id = p_id;
end;
$$;

create or replace function public.reorder_categories(p_org_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_user_id();
  v_id      uuid;
  v_index   int := 1;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = p_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  foreach v_id in array p_ordered_ids loop
    update public.categories set display_order = v_index
    where id = v_id and org_id = p_org_id;
    v_index := v_index + 1;
  end loop;
end;
$$;

-- =============================================================================
-- Kho mã vạch dùng chung
-- =============================================================================
create or replace function public.contribute_barcode(
  p_barcode      text,
  p_name         text,
  p_brand        text default null,
  p_image_url    text default null,
  p_default_unit text default 'cái'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text := regexp_replace(coalesce(p_barcode, ''), '\s', '', 'g');
begin
  if public.current_user_id() is null then
    raise exception 'Must be authenticated';
  end if;
  if not v_clean ~ '^\d{8,14}$' then
    raise exception 'Invalid barcode format: %', v_clean;
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Name required';
  end if;

  insert into public.shared_barcodes (barcode, name, brand, default_unit, image_url)
  values (
    v_clean,
    trim(p_name),
    nullif(trim(coalesce(p_brand, '')), ''),
    coalesce(nullif(trim(p_default_unit), ''), 'cái'),
    nullif(trim(coalesce(p_image_url, '')), '')
  )
  on conflict (barcode) do update set
    -- Chỉ điền vào chỗ trống, không ghi đè dữ liệu đã có của người khác
    name              = coalesce(nullif(public.shared_barcodes.name, ''), excluded.name),
    brand             = coalesce(public.shared_barcodes.brand, excluded.brand),
    image_url         = coalesce(public.shared_barcodes.image_url, excluded.image_url),
    default_unit      = coalesce(public.shared_barcodes.default_unit, excluded.default_unit),
    contributor_count = public.shared_barcodes.contributor_count + 1,
    last_updated_at   = now();
end;
$$;

-- =============================================================================
-- Kiểm kê tồn kho
-- =============================================================================
create or replace function public.create_stock_take(p_org_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_user_id();
  v_id      uuid;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = p_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  insert into public.stock_takes (org_id, taker_id, notes)
  values (p_org_id, v_user_id, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Helper nội bộ, KHÔNG grant cho ipos_app
create or replace function public.recompute_stock_take_totals(p_take_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stock_takes
  set total_items_count = coalesce((
        select count(*) from public.stock_take_items where stock_take_id = p_take_id
      ), 0),
      total_delta_value = coalesce((
        select sum(delta_value) from public.stock_take_items where stock_take_id = p_take_id
      ), 0)
  where id = p_take_id;
end;
$$;

create or replace function public.add_stock_take_item(
  p_take_id      uuid,
  p_product_id   uuid,
  p_actual_count numeric,
  p_reason       text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := public.current_user_id();
  v_org_id      uuid;
  v_status      text;
  v_product     record;
  v_delta       numeric;
  v_delta_value bigint;
  v_item_id     uuid;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;

  select org_id, status into v_org_id, v_status from public.stock_takes where id = p_take_id;
  if v_org_id is null then raise exception 'Stock take not found'; end if;
  if v_status != 'in_progress' then
    raise exception 'Stock take is not in_progress (status=%)', v_status;
  end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  select id, name, unit, stock, price_buy into v_product
  from public.products where id = p_product_id and org_id = v_org_id;
  if v_product.id is null then raise exception 'Product not found in this org'; end if;

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

create or replace function public.update_stock_take_item(
  p_item_id      uuid,
  p_actual_count numeric,
  p_reason       text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id     uuid := public.current_user_id();
  v_take_id     uuid;
  v_org_id      uuid;
  v_status      text;
  v_expected    numeric;
  v_unit_cost   bigint;
  v_delta       numeric;
  v_delta_value bigint;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;

  select sti.stock_take_id, sti.expected_stock, sti.unit_cost, st.org_id, st.status
  into v_take_id, v_expected, v_unit_cost, v_org_id, v_status
  from public.stock_take_items sti
  join public.stock_takes st on st.id = sti.stock_take_id
  where sti.id = p_item_id;

  if v_take_id is null then raise exception 'Stock take item not found'; end if;
  if v_status != 'in_progress' then raise exception 'Stock take is not in_progress'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  v_delta := p_actual_count - v_expected;
  v_delta_value := round(v_delta * v_unit_cost)::bigint;

  update public.stock_take_items
  set actual_count = p_actual_count,
      delta        = v_delta,
      delta_value  = v_delta_value,
      reason       = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_item_id;

  perform public.recompute_stock_take_totals(v_take_id);
end;
$$;

create or replace function public.remove_stock_take_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_user_id();
  v_take_id uuid;
  v_org_id  uuid;
  v_status  text;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;

  select sti.stock_take_id, st.org_id, st.status
  into v_take_id, v_org_id, v_status
  from public.stock_take_items sti
  join public.stock_takes st on st.id = sti.stock_take_id
  where sti.id = p_item_id;

  if v_take_id is null then raise exception 'Stock take item not found'; end if;
  if v_status != 'in_progress' then raise exception 'Stock take is not in_progress'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  delete from public.stock_take_items where id = p_item_id;
  perform public.recompute_stock_take_totals(v_take_id);
end;
$$;

-- Kiểm kê đặt kho TUYỆT ĐỐI: stock = actual_count, không cộng trừ delta.
create or replace function public.commit_stock_take(p_take_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_user_id();
  v_org_id  uuid;
  v_status  text;
  v_item    record;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;

  select org_id, status into v_org_id, v_status from public.stock_takes where id = p_take_id;
  if v_org_id is null then raise exception 'Stock take not found'; end if;
  if v_status != 'in_progress' then
    raise exception 'Stock take is not in_progress (status=%)', v_status;
  end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  for v_item in
    select product_id, actual_count from public.stock_take_items
    where stock_take_id = p_take_id and product_id is not null
  loop
    update public.products set stock = v_item.actual_count
    where id = v_item.product_id and org_id = v_org_id;
  end loop;

  update public.stock_takes set status = 'committed' where id = p_take_id;
end;
$$;

create or replace function public.cancel_stock_take(p_take_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_user_id();
  v_org_id  uuid;
  v_status  text;
begin
  if v_user_id is null then raise exception 'Must be authenticated'; end if;

  select org_id, status into v_org_id, v_status from public.stock_takes where id = p_take_id;
  if v_org_id is null then raise exception 'Stock take not found'; end if;
  if v_status != 'in_progress' then raise exception 'Stock take is not in_progress'; end if;
  if not exists (
    select 1 from public.memberships where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  update public.stock_takes set status = 'cancelled' where id = p_take_id;
end;
$$;

-- =============================================================================
-- Quản trị SaaS — chỉ super_admin
-- =============================================================================
create or replace function public.record_payment(
  p_org_id        uuid,
  p_amount        bigint,
  p_period_months int,
  p_method        text default 'bank_transfer',
  p_notes         text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub_id     uuid;
  v_paid_until date;
  v_payment_id uuid;
begin
  if not public.is_super_admin() then raise exception 'Forbidden: super_admin only'; end if;

  select id, paid_until_date into v_sub_id, v_paid_until
  from public.subscriptions where org_id = p_org_id;
  if v_sub_id is null then raise exception 'Subscription not found for org %', p_org_id; end if;

  insert into public.subscription_payments (
    subscription_id, amount, period_months, payment_method, recorded_by, notes
  ) values (
    v_sub_id, p_amount, p_period_months, p_method, public.current_user_id(), p_notes
  ) returning id into v_payment_id;

  -- Gia hạn từ mốc muộn hơn giữa hạn cũ và hôm nay, tránh trả tiền bù cho
  -- khoảng đã hết hạn.
  update public.subscriptions
  set paid_until_date = greatest(coalesce(v_paid_until, current_date), current_date)
                        + (p_period_months || ' months')::interval,
      status = 'active'
  where id = v_sub_id;

  return v_payment_id;
end;
$$;

create or replace function public.extend_trial(p_org_id uuid, p_new_trial_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Forbidden: super_admin only'; end if;
  update public.subscriptions
  set trial_until_date = p_new_trial_date, status = 'trial'
  where org_id = p_org_id;
end;
$$;

create or replace function public.suspend_shop(p_org_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Forbidden: super_admin only'; end if;
  update public.subscriptions
  set status = 'suspended',
      notes = coalesce(notes, '') || E'\n[Suspended ' || now()::text || ']: ' || coalesce(p_reason, '')
  where org_id = p_org_id;
end;
$$;

-- Không tự động mở khoá khi khách trả tiền — admin phải chủ động unsuspend.
create or replace function public.unsuspend_shop(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Forbidden: super_admin only'; end if;
  update public.subscriptions
  set status = case
    when paid_until_date is not null and paid_until_date > current_date then 'active'
    when trial_until_date is not null and trial_until_date > current_date then 'trial'
    else 'expired'
  end
  where org_id = p_org_id;
end;
$$;

create or replace function public.admin_list_shops()
returns table (
  org_id           uuid,
  org_name         text,
  owner_email      text,
  status           text,
  trial_until_date date,
  paid_until_date  date,
  monthly_price    bigint,
  latitude         numeric,
  longitude        numeric,
  address_full     text,
  last_order_at    timestamptz,
  total_revenue    bigint,
  products_count   int,
  orders_count     int,
  created_at       timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Forbidden: super_admin only'; end if;

  return query
  select
    o.id, o.name,
    coalesce(u.email, '—') as owner_email,
    coalesce(s.status, 'trial')::text,
    s.trial_until_date, s.paid_until_date,
    coalesce(s.monthly_price, 199000),
    o.latitude, o.longitude, o.address_full,
    (select max(ord.created_at) from public.orders ord where ord.org_id = o.id),
    coalesce((select sum(ord.total) from public.orders ord where ord.org_id = o.id), 0)::bigint,
    coalesce((select count(*) from public.products p where p.org_id = o.id and p.is_active), 0)::int,
    coalesce((select count(*) from public.orders ord where ord.org_id = o.id), 0)::int,
    o.created_at
  from public.organizations o
  left join public.subscriptions s on s.org_id = o.id
  left join lateral (
    select m.user_id from public.memberships m
    where m.org_id = o.id and m.role = 'owner'
    order by m.created_at asc limit 1
  ) m on true
  left join public.users u on u.id = m.user_id
  order by o.created_at desc;
end;
$$;

create or replace function public.admin_dashboard_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result      jsonb;
  v_month_start date := date_trunc('month', current_date);
begin
  if not public.is_super_admin() then raise exception 'Forbidden: super_admin only'; end if;

  select jsonb_build_object(
    'total_shops', (select count(*) from public.organizations),
    'active_shops', (select count(*) from public.subscriptions where status = 'active'),
    'trial_shops', (select count(*) from public.subscriptions where status = 'trial'),
    'expired_shops', (select count(*) from public.subscriptions where status = 'expired'),
    'suspended_shops', (select count(*) from public.subscriptions where status = 'suspended'),
    'mrr', coalesce((select sum(monthly_price)::bigint from public.subscriptions where status = 'active'), 0),
    'signups_this_month', (select count(*) from public.organizations where created_at >= v_month_start),
    'total_revenue_all_shops', coalesce((select sum(total)::bigint from public.orders), 0),
    'churn_this_month', (
      select count(*) from public.subscriptions
      where status in ('cancelled', 'expired') and updated_at >= v_month_start
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Tạo tiệm hộ khách. Phần mời chủ shop qua email do tầng API lo (cần gửi mail),
-- function này chỉ dựng org + subscription.
create or replace function public.admin_create_shop(
  p_org_name      text,
  p_owner_email   text,
  p_tax_code      text default null,
  p_address       text default null,
  p_address_full  text default null,
  p_phone         text default null,
  p_latitude      numeric default null,
  p_longitude     numeric default null,
  p_trial_days    int default 30,
  p_monthly_price bigint default 199000
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if not public.is_super_admin() then raise exception 'Forbidden: super_admin only'; end if;

  insert into public.organizations (name, tax_code, address, address_full, phone, latitude, longitude)
  values (p_org_name, p_tax_code, p_address, p_address_full, p_phone, p_latitude, p_longitude)
  returning id into v_org_id;

  insert into public.subscriptions (org_id, status, monthly_price, trial_until_date)
  values (v_org_id, 'trial', p_monthly_price, current_date + (p_trial_days || ' days')::interval);

  return jsonb_build_object(
    'org_id', v_org_id,
    'status', 'org_created_pending_invite',
    'owner_email', p_owner_email
  );
end;
$$;

-- Chạy được đúng một lần: có row trong super_admins là tự khoá.
create or replace function public.bootstrap_super_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_count   int;
begin
  select count(*) into v_count from public.super_admins;
  if v_count > 0 then
    raise exception 'Bootstrap already done; super_admins table has % rows', v_count;
  end if;

  select id into v_user_id from public.users where lower(email) = lower(p_email) limit 1;
  if v_user_id is null then raise exception 'No user with email %', p_email; end if;

  insert into public.super_admins (user_id) values (v_user_id);
  return v_user_id;
end;
$$;

create or replace function public.update_organization(
  p_org_id       uuid,
  p_name         text,
  p_tax_code     text,
  p_address      text,
  p_address_full text,
  p_phone        text,
  p_latitude     numeric,
  p_longitude    numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_id() is null then raise exception 'Must be authenticated'; end if;

  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.memberships
      where user_id = public.current_user_id() and org_id = p_org_id and role = 'owner'
    )
  ) then
    raise exception 'Forbidden: owner of org or super_admin only';
  end if;

  update public.organizations
  set name         = p_name,
      tax_code     = nullif(p_tax_code, ''),
      address      = nullif(p_address, ''),
      address_full = nullif(p_address_full, ''),
      phone        = nullif(p_phone, ''),
      latitude     = p_latitude,
      longitude    = p_longitude
  where id = p_org_id;
end;
$$;
