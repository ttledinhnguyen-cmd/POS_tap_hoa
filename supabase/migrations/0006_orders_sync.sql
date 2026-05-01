-- =============================================================================
-- 0006_orders_sync.sql — Realtime orders + RPC create_order_with_items
-- =============================================================================
-- Phase 5 sync layer cho orders.
--
-- 1. Bật realtime publication cho orders (KHÔNG bao gồm order_items —
--    pull on demand khi user xem detail report).
-- 2. RPC `create_order_with_items` — idempotent insert order + items + atomic
--    stock decrement, security definer, gate qua memberships.
--
-- Idempotent: client gen UUID v4 cho order.id; nếu retry với cùng id, RPC
-- detect existing row → return luôn, KHÔNG insert items lại, KHÔNG decrement
-- stock lần 2.
--
-- Stock allow negative (bán nợ là use case valid trong tạp hóa).
-- =============================================================================

-- 1. Realtime publication
alter publication supabase_realtime add table public.orders;

-- 2. RPC create_order_with_items
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
  v_org_id uuid := (p_order->>'org_id')::uuid;
  v_user_id uuid := auth.uid();
  v_existing uuid;
  v_item jsonb;
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

  -- IDEMPOTENT CHECK: order đã tồn tại → return luôn (skip insert + stock decrement)
  select id into v_existing from public.orders where id = v_order_id;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Insert order
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

  -- Insert items + atomic stock decrement (chỉ chạy lần đầu nhờ idempotent check)
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

    -- Stock decrement nếu product_id có (allow negative — bán nợ OK)
    if (v_item->>'product_id') is not null and (v_item->>'product_id') != '' then
      update public.products
      set stock = stock - (v_item->>'quantity')::numeric
      where id = (v_item->>'product_id')::uuid and org_id = v_org_id;
    end if;
  end loop;

  return v_order_id;
end;
$$;

revoke all on function public.create_order_with_items(jsonb, jsonb) from public;
grant execute on function public.create_order_with_items(jsonb, jsonb) to authenticated;
