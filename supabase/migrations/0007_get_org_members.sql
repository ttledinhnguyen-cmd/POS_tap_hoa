-- =============================================================================
-- 0007_get_org_members.sql — RPC list members của org (cho SettingsPage)
-- =============================================================================
-- Phase 1B SettingsPage cần list email + role của các thành viên cùng org.
-- auth.users không expose qua RLS thông thường → cần RPC security definer.
--
-- Authz: chỉ user thuộc org đó mới thấy được danh sách.
--
-- Note: dùng `joined_at` thay vì `created_at` cho OUT param để tránh clash
-- với column `m.created_at` (Postgres ambiguity error).
-- =============================================================================

create or replace function public.get_org_members(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  role text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
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
    select m.user_id, u.email::text, m.role, m.created_at
    from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
    order by m.created_at asc;
end;
$$;

revoke all on function public.get_org_members(uuid) from public;
grant execute on function public.get_org_members(uuid) to authenticated;
