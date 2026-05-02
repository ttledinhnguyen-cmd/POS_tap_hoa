-- =============================================================================
-- 0013_categories.sql — Quản lý danh mục sản phẩm per-org
-- =============================================================================
-- Hiện tại products.category là free-text (mỗi product tự gõ). Sau migration:
--   - Bảng categories có thứ tự custom + UI quản lý
--   - products.category vẫn TEXT (không FK), giữ snapshot tên để rename/delete
--     không bắt buộc cascade qua FK (an toàn hơn cho audit + simpler)
--   - RPC update_category cascade UPDATE products khi đổi tên
--   - RPC delete_category SET products.category = NULL (chuyển vào "Khác")
--
-- Thiết kế: KHÔNG FK products.category → categories(name) vì:
--   1. Lịch sử: orders/order_items snapshot category cũ phải giữ được
--   2. Tự do: cho phép gõ category mới ad-hoc trong ProductFormModal,
--      auto-create category nếu chưa có. FK sẽ block flow này.
-- =============================================================================

create table public.categories (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  name           text not null,
  display_order  int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index categories_org_name_uniq on public.categories(org_id, name);
create index categories_org_order_idx on public.categories(org_id, display_order);

create trigger categories_updated_at
  before update on public.categories
  for each row execute function extensions.moddatetime('updated_at');

-- RLS
alter table public.categories enable row level security;

create policy categories_select on public.categories
  for select to authenticated
  using (org_id in (select public.user_org_ids()));

-- KHÔNG có insert/update/delete policy → modify chỉ qua RPC security definer

-- Realtime publication
alter publication supabase_realtime add table public.categories;

-- -----------------------------------------------------------------------------
-- RPCs
-- -----------------------------------------------------------------------------

create or replace function public.create_category(
  p_org_id uuid,
  p_name   text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_id       uuid;
  v_clean    text := trim(coalesce(p_name, ''));
  v_next_ord int;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated';
  end if;
  if v_clean = '' then
    raise exception 'Name required';
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = p_org_id
  ) then
    raise exception 'Forbidden: not a member of this org';
  end if;

  -- Idempotent: nếu trùng tên trong org → return existing id
  select id into v_id from public.categories
  where org_id = p_org_id and name = v_clean;
  if v_id is not null then
    return v_id;
  end if;

  -- display_order = max + 1 (cuối list)
  select coalesce(max(display_order), 0) + 1 into v_next_ord
  from public.categories where org_id = p_org_id;

  insert into public.categories (org_id, name, display_order)
  values (p_org_id, v_clean, v_next_ord)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_category(uuid, text) from public;
grant execute on function public.create_category(uuid, text) to authenticated;

-- update_category: rename (cascade products) + reorder
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
  v_user_id  uuid := auth.uid();
  v_org_id   uuid;
  v_old_name text;
  v_clean    text;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated';
  end if;

  select org_id, name into v_org_id, v_old_name
  from public.categories where id = p_id;
  if v_org_id is null then
    raise exception 'Category not found';
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  -- Rename: cascade UPDATE products có category = old_name → new_name
  if p_new_name is not null then
    v_clean := trim(p_new_name);
    if v_clean = '' then
      raise exception 'New name cannot be empty';
    end if;
    if v_clean != v_old_name then
      -- Check trùng tên trong org
      if exists (
        select 1 from public.categories
        where org_id = v_org_id and name = v_clean and id != p_id
      ) then
        raise exception 'Category name already exists in this org';
      end if;
      update public.products
      set category = v_clean
      where org_id = v_org_id and category = v_old_name;
      update public.categories set name = v_clean where id = p_id;
    end if;
  end if;

  if p_new_order is not null then
    update public.categories set display_order = p_new_order where id = p_id;
  end if;
end;
$$;

revoke all on function public.update_category(uuid, text, int) from public;
grant execute on function public.update_category(uuid, text, int) to authenticated;

-- delete_category: SET products.category = NULL + delete row
create or replace function public.delete_category(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id  uuid;
  v_name    text;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated';
  end if;

  select org_id, name into v_org_id, v_name
  from public.categories where id = p_id;
  if v_org_id is null then
    raise exception 'Category not found';
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = v_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  -- Products mồ côi → category = NULL (sẽ vào "Khác" filter)
  update public.products
  set category = null
  where org_id = v_org_id and category = v_name;

  delete from public.categories where id = p_id;
end;
$$;

revoke all on function public.delete_category(uuid) from public;
grant execute on function public.delete_category(uuid) to authenticated;

-- reorder_categories: batch update display_order theo array index
create or replace function public.reorder_categories(
  p_org_id       uuid,
  p_ordered_ids  uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_id      uuid;
  v_index   int := 1;
begin
  if v_user_id is null then
    raise exception 'Must be authenticated';
  end if;
  if not exists (
    select 1 from public.memberships
    where user_id = v_user_id and org_id = p_org_id
  ) then
    raise exception 'Forbidden';
  end if;

  foreach v_id in array p_ordered_ids loop
    update public.categories
    set display_order = v_index
    where id = v_id and org_id = p_org_id;
    v_index := v_index + 1;
  end loop;
end;
$$;

revoke all on function public.reorder_categories(uuid, uuid[]) from public;
grant execute on function public.reorder_categories(uuid, uuid[]) to authenticated;
