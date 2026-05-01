-- =============================================================================
-- 0009_realtime_goods_receipts.sql — Phase 2BC: Realtime cho goods_receipts
-- =============================================================================
-- Bật postgres_changes publication cho table goods_receipts để 2 thiết bị
-- (vd. owner ở 2 tab/2 device) thấy phiếu mới sync tự động.
--
-- KHÔNG add goods_receipt_items vào publication — pull on demand khi user mở
-- ReceiptDetailSheet, giống pattern order_items (Phase 5).
-- =============================================================================

alter publication supabase_realtime add table public.goods_receipts;
