-- =============================================================================
-- 0005_realtime_products.sql — Bật Realtime publication cho products
-- =============================================================================
-- Phase 4: client subscribe channel `products:org_id=eq.{orgId}` để nhận
-- INSERT/UPDATE/DELETE realtime, đồng bộ Dexie cache giữa nhiều thiết bị
-- cùng tiệm.
--
-- Orders + order_items defer Phase 5 (cần thêm cho owner remote dashboard).
-- =============================================================================

alter publication supabase_realtime add table public.products;
