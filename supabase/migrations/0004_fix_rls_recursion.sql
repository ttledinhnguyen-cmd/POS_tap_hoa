-- =============================================================================
-- 0004_fix_rls_recursion.sql — Fix RLS infinite recursion trên memberships
-- =============================================================================
-- Backend test (2026-04-30) phát hiện:
--   ERROR: infinite recursion detected in policy for relation "memberships"
-- khi user mới signUp + create_organization rồi đọc memberships qua client.
--
-- Nguyên nhân: 2 policy của 0002_rls.sql self-reference bảng memberships
-- gây Postgres planner abort:
--   - memberships_select_self_or_org: subquery user_org_ids() → memberships
--   - memberships_modify_owner: subquery memberships trực tiếp
--
-- Fix: drop 2 policy này, thay bằng select-only chính-mình. Modify chuyển
-- toàn bộ qua RPC security definer (tương lai: add_team_member, remove_team_member).
-- =============================================================================

drop policy if exists "memberships_select_self_or_org" on public.memberships;
drop policy if exists "memberships_modify_owner" on public.memberships;

-- User chỉ thấy membership rows của chính mình.
-- Để xem danh sách thành viên khác trong cùng org, dùng RPC list_team_members()
-- (security definer, sẽ thêm khi cần feature team management).
create policy "memberships_select_self"
  on public.memberships for select
  using (user_id = auth.uid());

-- KHÔNG có insert/update/delete policy → deny by default cho client.
-- Mọi modify đi qua RPC security definer:
--   - create_organization: tạo org + self-insert owner (đã có ở 0003)
--   - (tương lai) add_team_member, change_role, remove_member
-- =============================================================================
