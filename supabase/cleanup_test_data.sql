-- =============================================================================
-- cleanup_test_data.sql — Xóa test orgs/users (MANUAL RUN, KHÔNG auto)
-- =============================================================================
-- ⚠️  DO NOT RUN ON PRODUCTION DATABASE — only dev/test cleanup ⚠️
--
-- CHẠY THỦ CÔNG khi cần dọn database trước launch / sau session test dài.
-- Founder REVIEW kỹ list orgs sẽ xóa TRƯỚC KHI uncomment SECTION 2/3.
--
-- Multi-layer safeguard chống wipe nhầm:
--   1. SECTION 1 (preview) chạy DRY-RUN trước → review danh sách
--   2. SECTION 2/3 commented out by default — phải uncomment thủ công
--   3. Tất cả DELETE đều có WHERE filter chặn:
--      - Founder email tt.ledinhnguyen@gmail.com
--      - User_id của bất kỳ super_admin nào (chống lock-out admin)
--   4. SECTION 4 ASSERT post-cleanup: super_admins count > 0
--      → script throw nếu accidentally xóa hết admin
--
-- Cascade behavior (đảm bảo bởi FK on delete cascade):
--   organizations DELETE → cascade memberships, products, orders, order_items,
--   goods_receipts, goods_receipt_items, subscriptions, subscription_payments,
--   stock_takes, stock_take_items, categories
--
-- KHÔNG xóa:
--   - User founder (tt.ledinhnguyen@gmail.com hardcoded)
--   - User của bất kỳ super_admin nào (defensive)
--   - shared_barcodes (data đã contribute là asset cộng đồng, KHÔNG xóa)
--   - Org có owner là founder (founder có thể tự tạo shop test với name "demo")
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECTION 1 — PREVIEW (chỉ SELECT, không xóa)
-- -----------------------------------------------------------------------------
-- 1a. Orgs sẽ xóa
select
  o.id,
  o.name,
  o.created_at,
  (select count(*) from public.products p where p.org_id = o.id) as products_count,
  (select count(*) from public.orders ord where ord.org_id = o.id) as orders_count
from public.organizations o
where (
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
)
-- Loại trừ org có owner là founder hoặc super_admin
and o.id not in (
  select m.org_id from public.memberships m
  where m.role = 'owner' and m.user_id in (
    select id from auth.users where email = 'tt.ledinhnguyen@gmail.com'
    union
    select user_id from public.super_admins
  )
)
order by o.created_at;

-- 1b. Users sẽ xóa (loại trừ founder + mọi super_admin)
select
  u.id,
  u.email,
  u.created_at,
  array_agg(o.name) as orgs
from auth.users u
left join public.memberships m on m.user_id = u.id
left join public.organizations o on o.id = m.org_id
where u.email != 'tt.ledinhnguyen@gmail.com'
  and u.id not in (select user_id from public.super_admins)
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

-- 1c. Sanity check: super_admins hiện có (phải > 0 trước & sau cleanup)
select user_id, added_at,
  (select email from auth.users where id = sa.user_id) as email
from public.super_admins sa;

-- -----------------------------------------------------------------------------
-- SECTION 2 — DELETE ORGS (UNCOMMENT KHI ĐÃ REVIEW SECTION 1)
-- -----------------------------------------------------------------------------
-- delete from public.organizations
-- where (
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
--   or name ilike '%sandbox%'
-- )
-- -- Chặn xóa org có owner là founder hoặc super_admin
-- and id not in (
--   select m.org_id from public.memberships m
--   where m.role = 'owner' and m.user_id in (
--     select id from auth.users where email = 'tt.ledinhnguyen@gmail.com'
--     union
--     select user_id from public.super_admins
--   )
-- );

-- -----------------------------------------------------------------------------
-- SECTION 3 — DELETE USERS (CHẠY SAU KHI ĐÃ DELETE ORGS)
-- auth.users DELETE thường phải qua admin API/Dashboard. SQL direct chỉ work
-- nếu chạy với service_role + DB Studio. Triple-protect:
--   - email != founder
--   - user_id NOT IN super_admins
--   - email pattern match test
-- -----------------------------------------------------------------------------
-- delete from auth.users
-- where email != 'tt.ledinhnguyen@gmail.com'
--   and id not in (select user_id from public.super_admins)
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
-- SECTION 4 — POST-CLEANUP ASSERT (chạy SAU section 2/3 để verify)
-- -----------------------------------------------------------------------------
-- DO $$
-- DECLARE
--   admin_count int;
--   founder_exists boolean;
-- BEGIN
--   SELECT count(*) INTO admin_count FROM public.super_admins;
--   IF admin_count = 0 THEN
--     RAISE EXCEPTION 'CLEANUP FAILED: super_admins table is EMPTY — admin lockout!';
--   END IF;
--
--   SELECT EXISTS(SELECT 1 FROM auth.users WHERE email='tt.ledinhnguyen@gmail.com')
--   INTO founder_exists;
--   IF NOT founder_exists THEN
--     RAISE EXCEPTION 'CLEANUP FAILED: founder user deleted!';
--   END IF;
--
--   RAISE NOTICE 'Post-cleanup OK: % super_admins, founder intact', admin_count;
-- END $$;

-- -----------------------------------------------------------------------------
-- POST-CLEANUP VIEW STATS
-- -----------------------------------------------------------------------------
-- select count(*) as orgs_remaining from public.organizations;
-- select count(*) as users_remaining from auth.users;
-- select count(*) as super_admins_remaining from public.super_admins;
-- select count(*) as shared_barcodes_remaining from public.shared_barcodes;
