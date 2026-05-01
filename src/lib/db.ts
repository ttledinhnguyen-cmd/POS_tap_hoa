import Dexie, { type EntityTable } from "dexie";
import type {
  GoodsReceipt,
  GoodsReceiptItem,
  Order,
  OrderItem,
  Product,
} from "@/types";
import type { OutboxJob } from "@/integrations/shared/queue";

/**
 * Database local lưu trong IndexedDB của trình duyệt.
 * Cho phép app hoạt động hoàn toàn offline.
 *
 * Phase 4 sync layer (products):
 * - Pull on login: supabase.from('products').where('org_id', orgId) → upsert Dexie
 * - Subscribe realtime: postgres_changes → patch Dexie (LWW theo updated_at)
 * - Local mutations: upsert Dexie + enqueue outbox → drain async lên Supabase
 *
 * Phase 5 sync layer (orders + order_items):
 * - Pull last 30 days on login + items embed.
 * - Subscribe realtime cho orders (items pull on demand khi UPDATE event).
 * - Local mutations qua RPC `create_order_with_items` (idempotent).
 *
 * Outbox pattern: thao tác cần đẩy lên server (sync, phát hành HĐĐT, gửi ZNS)
 * ghi vào table `outbox` trước → worker drain khi navigator.onLine.
 */
export class POSDatabase extends Dexie {
  products!: EntityTable<Product, "id">;
  orders!: EntityTable<Order, "id">;
  orderItems!: EntityTable<OrderItem, "id">;
  goodsReceipts!: EntityTable<GoodsReceipt, "id">;
  goodsReceiptItems!: EntityTable<GoodsReceiptItem, "id">;
  outbox!: EntityTable<OutboxJob, "id">;

  constructor() {
    super("pos-tap-hoa");
    this.version(1).stores({
      products: "id, barcode, name, category, updatedAt",
      orders: "id, createdAt, invoiceStatus",
    });
    // v2: thêm outbox cho offline-first sync (Sprint 1)
    this.version(2).stores({
      products: "id, barcode, name, category, updatedAt",
      orders: "id, createdAt, invoiceStatus",
      outbox: "id, type, nextRunAt, createdAt",
    });
    // v3: thêm orgId, isActive cho products (Phase 4 sync layer)
    this.version(3)
      .stores({
        products:
          "id, orgId, barcode, [orgId+barcode], [orgId+isActive], name, category, updatedAt",
        orders: "id, createdAt, invoiceStatus",
        outbox: "id, type, status, nextRunAt, createdAt",
      })
      .upgrade(async (tx) => {
        await tx
          .table<Product>("products")
          .toCollection()
          .modify((p) => {
            if (p.orgId === undefined) p.orgId = "";
            if (p.isActive === undefined) p.isActive = true;
          });
      });
    // v4: orders bổ sung orgId + thêm orderItems table riêng (Phase 5 sync layer)
    // Schema cũ orders có items[] embedded → bỏ field, di chuyển vào orderItems table.
    // Local Dexie data v3 chưa từng có order thật ngoài seed/test → upgrade chỉ
    // cần migrate metadata fields, items embedded sẽ bị bỏ qua (nếu có).
    this.version(4)
      .stores({
        products:
          "id, orgId, barcode, [orgId+barcode], [orgId+isActive], name, category, updatedAt",
        orders: "id, orgId, [orgId+createdAt], invoiceStatus, updatedAt",
        orderItems: "id, orderId, productId, [orderId+productId]",
        outbox: "id, type, status, nextRunAt, createdAt",
      })
      .upgrade(async (tx) => {
        // Ensure new fields default cho orders cũ (nếu có).
        await tx
          .table<Order>("orders")
          .toCollection()
          .modify((o) => {
            if (o.orgId === undefined) o.orgId = "";
            if (o.discount === undefined) o.discount = 0;
            if (o.invoiceStatus === undefined) o.invoiceStatus = "none";
            if (o.updatedAt === undefined) o.updatedAt = o.createdAt ?? Date.now();
            // Bỏ field items embedded cũ (Phase 5 dùng orderItems table)
            const legacy = o as unknown as { items?: unknown };
            if (legacy.items !== undefined) delete legacy.items;
          });
      });
    // v5: thêm goodsReceipts + goodsReceiptItems (Phase 2A nhập kho).
    // Tables mới — không cần migrate dữ liệu cũ.
    this.version(5).stores({
      products:
        "id, orgId, barcode, [orgId+barcode], [orgId+isActive], name, category, updatedAt",
      orders: "id, orgId, [orgId+createdAt], invoiceStatus, updatedAt",
      orderItems: "id, orderId, productId, [orderId+productId]",
      goodsReceipts: "id, orgId, [orgId+receiptDate], receiptDate, updatedAt",
      goodsReceiptItems: "id, receiptId, productId, [receiptId+productId]",
      outbox: "id, type, status, nextRunAt, createdAt",
    });
  }
}

export const db = new POSDatabase();
