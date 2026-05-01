-- =============================================================================
-- 0010_subscriptions_admin.sql — Sprint Admin SaaS
-- =============================================================================
-- Multi-tenant B2B infrastructure: founder (super_admin) quản lý subscriptions
-- của các tiệm khách. Bao gồm:
--   1. Geocoding columns trên organizations (lat/lng cho map)
--   2. Tables: subscriptions, subscription_payments, super_admins
--   3. is_super_admin() helper (SECURITY DEFINER, dùng EXISTS subquery,
--      KHÔNG dùng user_org_ids() để tránh recursion với policies)
--   4. RLS policies (no infinite recursion)
--   5. RPCs: record_payment, extend_trial, suspend_shop, unsuspend_shop,
--      admin_list_shops, admin_dashboard_metrics, admin_create_shop,
--      bootstrap_super_admin, update_organization
--
-- Decisions baked:
--   - Tier 'standard' default; 'pro' tier schema-only (UI defer)
--   - Trial flexible (admin set trial_until_date per shop)
--   - 1 subscription per org (UNIQUE org_id)
--   - Suspend KHÔNG auto-unsuspend khi paid; admin phải unsuspend
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Geocoding columns on organizations (cho ShopsMap)
-- -----------------------------------------------------------------------------
alter table public.organizations
  add column if not exists latitude     numeric(10,7),
  add column if not exists longitude    numeric(10,7),
  add column if not exists address_full text;

-- -----------------------------------------------------------------------------
-- 2. subscriptions table
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null unique references public.organizations(id) on delete cascade,
  tier                text not null default 'standard'
                        check (tier in ('standard', 'pro')),
  status              text not null default 'trial'
                        check (status in ('trial', 'active', 'expired', 'suspended', 'cancelled')),
  monthly_price       bigint not null default 199000,        -- VND
  trial_until_date    date,
  paid_until_date     date,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index subscriptions_status_idx on public.subscriptions(status);
create index subscriptions_paid_until_idx on public.subscriptions(paid_until_date)
  where status = 'active';

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function extensions.moddatetime('updated_at');

-- -----------------------------------------------------------------------------
-- 3. subscription_payments table
-- -----------------------------------------------------------------------------
create table public.subscription_payments (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  amount          bigint not null,
  payment_date    date not null default current_date,
  period_months   int not null,
  payment_method  text not null default 'bank_transfer'
                    check (payment_method in ('bank_transfer', 'cash', 'other')),
  recorded_by     uuid references auth.users(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now()
);

create index subscription_payments_sub_idx on public.subscription_payments(subscription_id, payment_date desc);

-- -----------------------------------------------------------------------------
-- 4. super_admins table
-- -----------------------------------------------------------------------------
create table public.super_admins (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  added_at  timestamptz not null default now(),
  added_by  uuid references auth.users(id) on delete set null
);

-- -----------------------------------------------------------------------------
-- 5. is_super_admin() helper — STABLE, SECURITY DEFINER
-- WARNING: KHÔNG dùng user_org_ids() trong policies bên dưới — đã từng gặp
-- recursion ở Phase 2 với memberships. Helper này dùng EXISTS subquery trực
-- tiếp lên super_admins, an toàn vì super_admins KHÔNG có policy gọi ngược.
-- -----------------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.super_admins where user_id = auth.uid()
  );
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- 6. RLS — bật cả 3 tables
-- -----------------------------------------------------------------------------
alter table public.subscriptions enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.super_admins enable row level security;

-- subscriptions: select cho member của org HOẶC super_admin; modify chỉ super_admin
create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.memberships
      where memberships.user_id = auth.uid()
        and memberships.org_id = subscriptions.org_id
    )
  );
create policy subscriptions_modify on public.subscriptions
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- subscription_payments: filter qua subscription_id → org membership
create policy subscription_payments_select on public.subscription_payments
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1
      from public.subscriptions s
      join public.memberships m on m.org_id = s.org_id
      where s.id = subscription_payments.subscription_id
        and m.user_id = auth.uid()
    )
  );
create policy subscription_payments_modify on public.subscription_payments
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- super_admins: chỉ super_admin xem + modify
create policy super_admins_select on public.super_admins
  for select to authenticated
  using (public.is_super_admin());
create policy super_admins_modify on public.super_admins
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 7. RPCs
-- -----------------------------------------------------------------------------

-- record_payment: ghi payment + extend paid_until_date + status='active'
create or replace function public.record_payment(
  p_org_id         uuid,
  p_amount         bigint,
  p_period_months  int,
  p_method         text default 'bank_transfer',
  p_notes          text default null
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
  if not public.is_super_admin() then
    raise exception 'Forbidden: super_admin only';
  end if;

  select id, paid_until_date into v_sub_id, v_paid_until
  from public.subscriptions where org_id = p_org_id;
  if v_sub_id is null then
    raise exception 'Subscription not found for org %', p_org_id;
  end if;

  insert into public.subscription_payments (
    subscription_id, amount, period_months, payment_method, recorded_by, notes
  ) values (
    v_sub_id, p_amount, p_period_months, p_method, auth.uid(), p_notes
  ) returning id into v_payment_id;

  -- Extend paid_until: max(current paid_until, today) + N months
  update public.subscriptions
  set
    paid_until_date = greatest(coalesce(v_paid_until, current_date), current_date)
                       + (p_period_months || ' months')::interval,
    status          = 'active'
  where id = v_sub_id;

  return v_payment_id;
end;
$$;

revoke all on function public.record_payment(uuid, bigint, int, text, text) from public;
grant execute on function public.record_payment(uuid, bigint, int, text, text) to authenticated;

-- extend_trial
create or replace function public.extend_trial(
  p_org_id         uuid,
  p_new_trial_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Forbidden: super_admin only';
  end if;
  update public.subscriptions
  set trial_until_date = p_new_trial_date,
      status = 'trial'
  where org_id = p_org_id;
end;
$$;

revoke all on function public.extend_trial(uuid, date) from public;
grant execute on function public.extend_trial(uuid, date) to authenticated;

-- suspend_shop
create or replace function public.suspend_shop(
  p_org_id  uuid,
  p_reason  text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Forbidden: super_admin only';
  end if;
  update public.subscriptions
  set status = 'suspended',
      notes = coalesce(notes, '') || E'\n[Suspended ' || now()::text || ']: ' || coalesce(p_reason, '')
  where org_id = p_org_id;
end;
$$;

revoke all on function public.suspend_shop(uuid, text) from public;
grant execute on function public.suspend_shop(uuid, text) to authenticated;

-- unsuspend_shop — derive status từ paid_until / trial_until
create or replace function public.unsuspend_shop(
  p_org_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Forbidden: super_admin only';
  end if;
  update public.subscriptions
  set status = case
    when paid_until_date is not null and paid_until_date > current_date then 'active'
    when trial_until_date is not null and trial_until_date > current_date then 'trial'
    else 'expired'
  end
  where org_id = p_org_id;
end;
$$;

revoke all on function public.unsuspend_shop(uuid) from public;
grant execute on function public.unsuspend_shop(uuid) to authenticated;

-- admin_list_shops — full table với stats
create or replace function public.admin_list_shops()
returns table (
  org_id            uuid,
  org_name          text,
  owner_email       text,
  status            text,
  trial_until_date  date,
  paid_until_date   date,
  monthly_price     bigint,
  latitude          numeric,
  longitude         numeric,
  address_full      text,
  last_order_at     timestamptz,
  total_revenue     bigint,
  products_count    int,
  orders_count      int,
  created_at        timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Forbidden: super_admin only';
  end if;

  return query
  select
    o.id,
    o.name,
    coalesce(u.email, '—') as owner_email,
    coalesce(s.status, 'trial')::text,
    s.trial_until_date,
    s.paid_until_date,
    coalesce(s.monthly_price, 199000),
    o.latitude,
    o.longitude,
    o.address_full,
    (select max(ord.created_at) from public.orders ord where ord.org_id = o.id) as last_order_at,
    coalesce((select sum(ord.total) from public.orders ord where ord.org_id = o.id), 0)::bigint as total_revenue,
    coalesce((select count(*) from public.products p where p.org_id = o.id and p.is_active = true), 0)::int as products_count,
    coalesce((select count(*) from public.orders ord where ord.org_id = o.id), 0)::int as orders_count,
    o.created_at
  from public.organizations o
  left join public.subscriptions s on s.org_id = o.id
  left join lateral (
    select m.user_id from public.memberships m
    where m.org_id = o.id and m.role = 'owner'
    order by m.created_at asc
    limit 1
  ) m on true
  left join auth.users u on u.id = m.user_id
  order by o.created_at desc;
end;
$$;

revoke all on function public.admin_list_shops() from public;
grant execute on function public.admin_list_shops() to authenticated;

-- admin_dashboard_metrics — aggregate metrics
create or replace function public.admin_dashboard_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_month_start date := date_trunc('month', current_date);
begin
  if not public.is_super_admin() then
    raise exception 'Forbidden: super_admin only';
  end if;

  select jsonb_build_object(
    'total_shops', (select count(*) from public.organizations),
    'active_shops', (select count(*) from public.subscriptions where status = 'active'),
    'trial_shops', (select count(*) from public.subscriptions where status = 'trial'),
    'expired_shops', (select count(*) from public.subscriptions where status = 'expired'),
    'suspended_shops', (select count(*) from public.subscriptions where status = 'suspended'),
    'mrr', coalesce((
      select sum(monthly_price)::bigint from public.subscriptions where status = 'active'
    ), 0),
    'signups_this_month', (
      select count(*) from public.organizations where created_at >= v_month_start
    ),
    'total_revenue_all_shops', coalesce((
      select sum(total)::bigint from public.orders
    ), 0),
    'churn_this_month', (
      select count(*) from public.subscriptions
      where status in ('cancelled', 'expired')
        and updated_at >= v_month_start
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_dashboard_metrics() from public;
grant execute on function public.admin_dashboard_metrics() to authenticated;

-- admin_create_shop — insert org + subscription, return org_id (Edge Function
-- xử lý invite email + membership với service_role)
create or replace function public.admin_create_shop(
  p_org_name       text,
  p_owner_email    text,
  p_tax_code       text default null,
  p_address        text default null,
  p_address_full   text default null,
  p_phone          text default null,
  p_latitude       numeric default null,
  p_longitude      numeric default null,
  p_trial_days     int default 30,
  p_monthly_price  bigint default 199000
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Forbidden: super_admin only';
  end if;

  insert into public.organizations (name, tax_code, address, address_full, phone, latitude, longitude)
  values (p_org_name, p_tax_code, p_address, p_address_full, p_phone, p_latitude, p_longitude)
  returning id into v_org_id;

  insert into public.subscriptions (org_id, status, monthly_price, trial_until_date)
  values (
    v_org_id,
    'trial',
    p_monthly_price,
    current_date + (p_trial_days || ' days')::interval
  );

  return jsonb_build_object(
    'org_id', v_org_id,
    'status', 'org_created_pending_invite',
    'owner_email', p_owner_email
  );
end;
$$;

revoke all on function public.admin_create_shop(text, text, text, text, text, text, numeric, numeric, int, bigint) from public;
grant execute on function public.admin_create_shop(text, text, text, text, text, text, numeric, numeric, int, bigint) to authenticated;

-- bootstrap_super_admin — chạy 1 lần để bootstrap admin đầu tiên
-- KHÔNG verify is_super_admin (vì lúc đầu chưa ai là admin).
-- Auto-lock sau lần đầu nhờ check super_admins table empty.
create or replace function public.bootstrap_super_admin(
  p_email text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_count   int;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated';
  end if;

  select count(*) into v_count from public.super_admins;
  if v_count > 0 then
    raise exception 'Bootstrap already done; super_admins table has % rows', v_count;
  end if;

  select id into v_user_id from auth.users where email = p_email limit 1;
  if v_user_id is null then
    raise exception 'No user with email %', p_email;
  end if;

  insert into public.super_admins (user_id, added_by)
  values (v_user_id, auth.uid());

  return v_user_id;
end;
$$;

revoke all on function public.bootstrap_super_admin(text) from public;
grant execute on function public.bootstrap_super_admin(text) to authenticated;

-- update_organization — owner sửa info tiệm (bao gồm address + lat/lng)
create or replace function public.update_organization(
  p_org_id        uuid,
  p_name          text,
  p_tax_code      text,
  p_address       text,
  p_address_full  text,
  p_phone         text,
  p_latitude      numeric,
  p_longitude     numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated';
  end if;

  -- Owner của org_id HOẶC super_admin
  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.memberships
      where user_id = auth.uid() and org_id = p_org_id and role = 'owner'
    )
  ) then
    raise exception 'Forbidden: owner of org or super_admin only';
  end if;

  update public.organizations
  set
    name         = p_name,
    tax_code     = nullif(p_tax_code, ''),
    address      = nullif(p_address, ''),
    address_full = nullif(p_address_full, ''),
    phone        = nullif(p_phone, ''),
    latitude     = p_latitude,
    longitude    = p_longitude
  where id = p_org_id;
end;
$$;

revoke all on function public.update_organization(uuid, text, text, text, text, text, numeric, numeric) from public;
grant execute on function public.update_organization(uuid, text, text, text, text, text, numeric, numeric) to authenticated;
