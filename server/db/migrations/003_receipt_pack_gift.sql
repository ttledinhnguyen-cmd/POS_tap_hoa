-- =============================================================================
-- 003_receipt_pack_gift.sql — Nhập hàng theo thùng + hàng tặng + gắn nhà cung cấp
-- =============================================================================
SET client_encoding = 'UTF8';

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
  v_supplier   uuid := nullif(p_receipt->>'supplier_id', '')::uuid;
  v_existing   uuid;
  v_item       jsonb;
  v_pack_qty   numeric;
  v_pack_size  numeric;
  v_qty        numeric;
  v_unit_cost  bigint;
  v_is_gift    boolean;
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

  -- Nhà cung cấp phải thuộc cùng tiệm, tránh gắn nhầm sang tiệm khác
  if v_supplier is not null and not exists (
    select 1 from public.suppliers where id = v_supplier and org_id = v_org_id
  ) then
    raise exception 'Nhà cung cấp không thuộc tiệm này';
  end if;

  select id into v_existing from public.goods_receipts where id = v_receipt_id;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.goods_receipts (
    id, org_id, receiver_id, supplier_id, supplier_name, supplier_phone,
    supplier_tax_code, receipt_date, invoice_no, total_cost, notes, due_date, created_at
  ) values (
    v_receipt_id, v_org_id, v_user_id, v_supplier,
    -- Vẫn lưu tên dạng chữ làm ảnh chụp: đổi tên NCC về sau không được làm
    -- sai lệch phiếu cũ.
    coalesce(
      nullif(p_receipt->>'supplier_name', ''),
      (select name from public.suppliers where id = v_supplier)
    ),
    nullif(p_receipt->>'supplier_phone', ''),
    nullif(p_receipt->>'supplier_tax_code', ''),
    coalesce((p_receipt->>'receipt_date')::date, current_date),
    nullif(p_receipt->>'invoice_no', ''),
    coalesce((p_receipt->>'total_cost')::bigint, 0),
    nullif(p_receipt->>'notes', ''),
    nullif(p_receipt->>'due_date', '')::date,
    coalesce((p_receipt->>'created_at')::timestamptz, now())
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_pack_qty  := nullif(v_item->>'pack_qty', '')::numeric;
    v_pack_size := nullif(v_item->>'pack_size', '')::numeric;
    v_is_gift   := coalesce((v_item->>'is_gift')::boolean, false);

    -- Số lượng theo ĐƠN VỊ BÁN. Nhập theo thùng thì server tự nhân ra, không
    -- tin con số client gửi — để hai bên không lệch nhau khi client có bug.
    if v_pack_qty is not null and v_pack_size is not null and v_pack_size > 0 then
      v_qty := v_pack_qty * v_pack_size;
    else
      v_qty := (v_item->>'quantity')::numeric;
    end if;

    -- Giá vốn mỗi đơn vị bán. Hàng tặng thì bằng 0.
    if v_is_gift then
      v_unit_cost := 0;
    elsif v_pack_qty is not null and v_pack_size is not null and v_pack_size > 0
          and (v_item->>'pack_price') is not null then
      v_unit_cost := round((v_item->>'pack_price')::numeric / v_pack_size)::bigint;
    else
      v_unit_cost := (v_item->>'price_buy')::bigint;
    end if;

    insert into public.goods_receipt_items (
      id, receipt_id, product_id, product_name, unit, quantity,
      price_buy, line_total, pack_qty, pack_size, pack_unit, is_gift
    ) values (
      coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid()),
      v_receipt_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      v_item->>'unit',
      v_qty,
      v_unit_cost,
      round(v_unit_cost * v_qty)::bigint,
      v_pack_qty,
      v_pack_size,
      nullif(v_item->>'pack_unit', ''),
      v_is_gift
    );

    if nullif(v_item->>'product_id', '') is not null then
      -- Hàng tặng CỘNG kho nhưng KHÔNG đụng giá vốn. Ghi đè bằng 0 sẽ làm báo
      -- cáo lãi sai bét — đây là bẫy kinh điển với khuyến mãi "mua 10 tặng 1".
      if v_is_gift then
        update public.products
        set stock = stock + v_qty
        where id = (v_item->>'product_id')::uuid and org_id = v_org_id;
      else
        update public.products
        set stock = stock + v_qty,
            price_buy = v_unit_cost,
            -- Ghi nhớ quy cách đóng gói để lần nhập sau gợi ý sẵn
            pack_size = coalesce(v_pack_size, pack_size),
            pack_unit = coalesce(nullif(v_item->>'pack_unit', ''), pack_unit)
        where id = (v_item->>'product_id')::uuid and org_id = v_org_id;
      end if;
    end if;
  end loop;

  return v_receipt_id;
end;
$$;

revoke all on function public.create_goods_receipt(jsonb, jsonb) from public;
grant execute on function public.create_goods_receipt(jsonb, jsonb) to ipos_app;
