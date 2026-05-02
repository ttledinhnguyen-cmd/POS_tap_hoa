-- =============================================================================
-- cleanup_test_data.sql — Xóa test orgs/users (MANUAL RUN, KHÔNG auto)
-- =============================================================================
-- CHẠY THỦ CÔNG khi cần dọn database trước launch / sau session test dài.
-- Founder REVIEW kỹ list orgs sẽ xóa trước khi commit.
--
-- Cascade behavior (đảm bảo bởi FK on delete cascade):
--   organizations DELETE → cascade memberships, products, orders, order_items,
--   goods_receipts, goods_receipt_items, subscriptions, subscription_payments
--
-- KHÔNG xóa:
--   - User founder + super_admin (`tt.ledinhnguyen@gmail.com` hardcoded check)
--   - shared_barcodes (data đã contribute là asset)
--
-- Cách dùng:
--   1. SQL Editor Supabase Dashboard → paste file này
--   2. Chạy SECTION 1 (preview) trước → review list
--   3. Nếu OK, uncomment SECTION 2 + chạy DELETE
--   4. SECTION 3 xóa users tương ứng (auth.users không có FK xuống organizations
--      nên cần xóa rời, qua auth.admin API hoặc Dashboard manually)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECTION 1 — PREVIEW (chỉ SELECT, không xóa)
-- -----------------------------------------------------------------------------
select
  o.id,
  o.name,
  o.created_at,
  (select count(*) from public.products p where p.org_id = o.id) as products_count,
  (select count(*) from public.orders ord where ord.org_id = o.id) as orders_count,
  (select count(*) from public.goods_receipts g where g.org_id = o.id) as receipts_count
from public.organizations o
where
  o.name ilike '%test%'
  or o.name ilike '%p1a%'
  or o.name ilike '%p1b%'
  or o.name ilike '%p1c%'
  or o.name ilike '%p2a%'
  or o.name ilike '%p2bc%'
  or o.name ilike '%phase%'
  or o.name ilike '%smoke%'
  or o.name ilike '%polish%'
  or o.name ilike '%dev%'
  or o.name ilike '%demo%'
  or o.name ilike '%sandbox%'
order by o.created_at;

-- Preview users sẽ orphan sau khi xóa orgs (chỉ thuộc 1 trong các test orgs)
select
  u.id,
  u.email,
  u.created_at,
  array_agg(o.name) as orgs
from auth.users u
left join public.memberships m on m.user_id = u.id
left join public.organizations o on o.id = m.org_id
where u.email != 'tt.ledinhnguyen@gmail.com'  -- KHÔNG động founder
  and (
    u.email ilike '%test%'
    or u.email ilike '%p1a%'
    or u.email ilike '%p1b%'
    or u.email ilike '%p1c%'
    or u.email ilike '%p2a%'
    or u.email ilike '%phase%'
    or u.email ilike '%smoke%'
    or u.email ilike '%example.com'
  )
group by u.id, u.email, u.created_at
order by u.created_at;

-- -----------------------------------------------------------------------------
-- SECTION 2 — DELETE ORGS (UNCOMMENT KHI ĐÃ REVIEW)
-- -----------------------------------------------------------------------------
-- delete from public.organizations
-- where
--   name ilike '%test%'
--   or name ilike '%p1a%'
--   or name ilike '%p1b%'
--   or name ilike '%p1c%'
--   or name ilike '%p2a%'
--   or name ilike '%p2bc%'
--   or name ilike '%phase%'
--   or name ilike '%smoke%'
--   or name ilike '%polish%'
--   or name ilike '%dev%'
--   or name ilike '%demo%'
--   or name ilike '%sandbox%';

-- -----------------------------------------------------------------------------
-- SECTION 3 — DELETE USERS (CHẠY SAU KHI ĐÃ DELETE ORGS)
-- auth.users DELETE phải qua admin API hoặc dashboard (không có direct GRANT
-- cho authenticated). Cách an toàn:
--   - Dashboard: Authentication → Users → search email pattern → delete từng user
--   - Hoặc Edge Function với service_role gọi auth.admin.deleteUser(uid)
-- -----------------------------------------------------------------------------
-- delete from auth.users
-- where email != 'tt.ledinhnguyen@gmail.com'
--   and (
--     email ilike '%test%'
--     or email ilike '%p1a%'
--     or email ilike '%p1b%'
--     or email ilike '%p1c%'
--     or email ilike '%phase%'
--     or email ilike '%smoke%'
--     or email ilike '%example.com'
--   );

-- -----------------------------------------------------------------------------
-- POST-CLEANUP VERIFY
-- -----------------------------------------------------------------------------
-- select count(*) as orgs_remaining from public.organizations;
-- select count(*) as users_remaining from auth.users;
-- select count(*) as shared_barcodes_remaining from public.shared_barcodes;
