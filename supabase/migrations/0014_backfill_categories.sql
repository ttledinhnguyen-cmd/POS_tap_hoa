-- =============================================================================
-- 0014_backfill_categories.sql — Backfill categories table từ products.category
-- =============================================================================
-- Phase 0013 tạo bảng categories nhưng KHÔNG migrate data từ products.category
-- text field hiện có. Hậu quả: CategoryManagerSheet hiển thị empty trong khi
-- POSPage chips fallback-derive vẫn show categories.
--
-- Fix: insert distinct trim(category) per org vào categories table với
-- display_order = ROW_NUMBER alphabet sort.
--
-- Idempotent: ON CONFLICT (org_id, name) DO NOTHING — safe re-run.
-- KHÔNG động products.category text — vẫn giữ nguyên (free-form by design).
-- =============================================================================

INSERT INTO public.categories (org_id, name, display_order)
SELECT
  org_id,
  trim(category) AS name,
  ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY trim(category)) AS display_order
FROM (
  SELECT DISTINCT org_id, category
  FROM public.products
  WHERE category IS NOT NULL
    AND trim(category) <> ''
) src
ON CONFLICT (org_id, name) DO NOTHING;
