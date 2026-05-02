-- =============================================================================
-- 0015_fix_admin_list_shops.sql — Fix type mismatch trong admin_list_shops RPC
-- =============================================================================
-- Bug: auth.users.email là varchar(255), nhưng OUT param owner_email declared
-- text. Postgres strict-check column type gây lỗi 42804:
--   "structure of query does not match function result type
--    DETAIL: Returned type character varying does not match expected type text"
--
-- Hậu quả: AdminShopsPage call admin_list_shops fail với error mờ → UI hiện
-- "tải shop thất bại" generic.
--
-- Fix: cast u.email::text + o.name::text + o.address_full::text để match
-- explicit type. Cũng cast s.trial_until_date / s.paid_until_date nếu cần.
-- (date type khớp, không cần cast.)
-- =============================================================================

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
    o.name::text,
    coalesce(u.email, '—')::text as owner_email,
    coalesce(s.status, 'trial')::text,
    s.trial_until_date,
    s.paid_until_date,
    coalesce(s.monthly_price, 199000)::bigint,
    o.latitude,
    o.longitude,
    o.address_full::text,
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
