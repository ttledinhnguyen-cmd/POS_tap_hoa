-- =============================================================================
-- 004_supplier_name_unaccent.sql — Khớp tên nhà cung cấp bỏ qua dấu tiếng Việt
-- =============================================================================
-- Chủ tiệm gõ tên NCC trên điện thoại thường bỏ dấu: "npp masan mien nam" hôm
-- nay, "NPP Masan Miền Nam" hôm sau. Chỉ dùng lower() thì thành hai nhà cung
-- cấp khác nhau, và công nợ bị chia đôi — sai kiểu âm thầm, chủ tiệm chỉ phát
-- hiện khi đối chiếu sổ với NPP.
SET client_encoding = 'UTF8';

-- CHẠY BẰNG SUPERUSER, KHÔNG phải ipos_owner: tạo extension đòi quyền CREATE
-- trên database. apply-schema.ps1 chạy dòng này trước khi SET ROLE.
create extension if not exists unaccent;

-- unaccent() vốn là STABLE nên không dùng trực tiếp trong index được. Bọc lại
-- thành IMMUTABLE với dictionary chỉ định rõ — an toàn vì dictionary không đổi.
create or replace function public.vn_norm(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_catalog
as $$
  select lower(btrim(unaccent('unaccent', coalesce(p_text, ''))))
$$;

-- Đổi unique index sang bản chuẩn hoá. Gộp trùng trước, nếu không index sẽ
-- không tạo được.
do $$
declare
  v_dup record;
begin
  for v_dup in
    select org_id, public.vn_norm(name) as norm, min(created_at) as first_at
    from public.suppliers
    group by org_id, public.vn_norm(name)
    having count(*) > 1
  loop
    -- Giữ bản ghi cũ nhất, chuyển phiếu nhập và khoản trả của bản trùng về nó
    with keep as (
      select id from public.suppliers
      where org_id = v_dup.org_id and public.vn_norm(name) = v_dup.norm
      order by created_at limit 1
    ), dupes as (
      select id from public.suppliers
      where org_id = v_dup.org_id and public.vn_norm(name) = v_dup.norm
        and id <> (select id from keep)
    )
    update public.goods_receipts
    set supplier_id = (select id from keep)
    where supplier_id in (select id from dupes);

    with keep as (
      select id from public.suppliers
      where org_id = v_dup.org_id and public.vn_norm(name) = v_dup.norm
      order by created_at limit 1
    ), dupes as (
      select id from public.suppliers
      where org_id = v_dup.org_id and public.vn_norm(name) = v_dup.norm
        and id <> (select id from keep)
    )
    update public.supplier_payments
    set supplier_id = (select id from keep)
    where supplier_id in (select id from dupes);

    delete from public.suppliers s
    where s.org_id = v_dup.org_id and public.vn_norm(s.name) = v_dup.norm
      and s.id <> (
        select id from public.suppliers
        where org_id = v_dup.org_id and public.vn_norm(name) = v_dup.norm
        order by created_at limit 1
      );
  end loop;
end
$$;

drop index if exists suppliers_org_name_uniq;
create unique index suppliers_org_name_uniq
  on public.suppliers(org_id, public.vn_norm(name));

-- Cập nhật upsert_supplier để tra theo tên đã chuẩn hoá
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

  -- Khớp bỏ dấu + bỏ hoa thường: "npp masan mien nam" tìm ra "NPP Masan Miền Nam"
  select id into v_id from public.suppliers
  where org_id = p_org_id and public.vn_norm(name) = public.vn_norm(v_clean);
  if v_id is not null then
    -- Bổ sung thông tin còn thiếu, không ghi đè thứ đã có
    update public.suppliers
    set phone    = coalesce(phone, nullif(btrim(coalesce(p_phone, '')), '')),
        tax_code = coalesce(tax_code, nullif(btrim(coalesce(p_tax_code, '')), '')),
        address  = coalesce(address, nullif(btrim(coalesce(p_address, '')), ''))
    where id = v_id;
    return v_id;
  end if;

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

revoke all on function public.upsert_supplier(uuid, text, uuid, text, text, text, text) from public;
grant execute on function public.upsert_supplier(uuid, text, uuid, text, text, text, text) to ipos_app;
grant execute on function public.vn_norm(text) to ipos_app;
