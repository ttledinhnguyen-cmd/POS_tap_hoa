-- =============================================================================
-- 0002_rls.sql — Row Level Security
-- =============================================================================
-- Tham chiếu: docs/API_INTEGRATION_SPEC.md section 1.1 (RLS policies)
--
-- Nguyên tắc: user chỉ thấy/sửa data của org mình thuộc (qua bảng memberships).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: user_org_ids() — danh sách org_id mà user hiện tại thuộc về
-- security definer + stable: cache được trong cùng câu query, bypass RLS của memberships
-- -----------------------------------------------------------------------------
create or replace function public.user_org_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from public.memberships where user_id = auth.uid()
$$;

-- -----------------------------------------------------------------------------
-- Bật RLS toàn bộ table public
-- -----------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.products      enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.webhook_events enable row level security;
alter table public.outbox        enable row level security;

-- -----------------------------------------------------------------------------
-- organizations: thấy org mình thuộc; chỉ owner mới sửa được
-- -----------------------------------------------------------------------------
create policy "organizations_select"
  on public.organizations for select
  using (id in (select public.user_org_ids()));

create policy "organizations_update_owner"
  on public.organizations for update
  using (
    id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- INSERT organization là việc đặc biệt (signup flow), tạm thời cho phép
-- authenticated user tạo (sẽ siết lại ở Sprint 2 khi có signup wizard).
create policy "organizations_insert_authenticated"
  on public.organizations for insert
  to authenticated
  with check (true);

-- -----------------------------------------------------------------------------
-- memberships: user thấy membership của chính mình + của org mình thuộc
-- chỉ owner mới insert/update/delete membership
-- -----------------------------------------------------------------------------
create policy "memberships_select_self_or_org"
  on public.memberships for select
  using (
    user_id = auth.uid()
    or org_id in (select public.user_org_ids())
  );

create policy "memberships_modify_owner"
  on public.memberships for all
  using (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role = 'owner'
    )
  )
  with check (
    org_id in (
      select org_id from public.memberships
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- -----------------------------------------------------------------------------
-- products: full CRUD trong phạm vi org
-- -----------------------------------------------------------------------------
create policy "products_select"
  on public.products for select
  using (org_id in (select public.user_org_ids()));

create policy "products_modify"
  on public.products for all
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- -----------------------------------------------------------------------------
-- orders: full CRUD trong phạm vi org
-- -----------------------------------------------------------------------------
create policy "orders_select"
  on public.orders for select
  using (org_id in (select public.user_org_ids()));

create policy "orders_modify"
  on public.orders for all
  using (org_id in (select public.user_org_ids()))
  with check (org_id in (select public.user_org_ids()));

-- -----------------------------------------------------------------------------
-- order_items: gate qua orders.org_id
-- -----------------------------------------------------------------------------
create policy "order_items_select"
  on public.order_items for select
  using (
    order_id in (
      select id from public.orders
      where org_id in (select public.user_org_ids())
    )
  );

create policy "order_items_modify"
  on public.order_items for all
  using (
    order_id in (
      select id from public.orders
      where org_id in (select public.user_org_ids())
    )
  )
  with check (
    order_id in (
      select id from public.orders
      where org_id in (select public.user_org_ids())
    )
  );

-- -----------------------------------------------------------------------------
-- webhook_events: KHÔNG cho client truy cập trực tiếp.
-- Edge Functions với service_role key sẽ bypass RLS để insert/read.
-- (RLS đã bật → mọi anon/authenticated query đều bị deny default.)
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- outbox: tương tự webhook_events — chỉ Edge Functions thao tác.
-- -----------------------------------------------------------------------------
