import { Poller, maxUpdatedAt } from "@/integrations/sync/poller";
import { db } from "@/lib/db";
import type {
  GoodsReceipt,
  GoodsReceiptItem,
  ReceiveInput,
  ReceiveItemInput,
} from "@/types";
import { api } from "@/integrations/api";
import type { OutboxJob } from "@/integrations/shared/queue";

/**
 * Supabase row goods_receipts (snake_case + ISO timestamps).
 */
interface GoodsReceiptRow {
  id: string;
  org_id: string;
  receiver_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_tax_code: string | null;
  receipt_date: string; // YYYY-MM-DD
  invoice_no: string | null;
  total_cost: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface GoodsReceiptItemRow {
  id: string;
  receipt_id: string;
  product_id: string | null;
  product_name: string;
  unit: string;
  quantity: number;
  price_buy: number;
  line_total: number;
}

function fromRow(row: GoodsReceiptRow): GoodsReceipt {
  return {
    id: row.id,
    orgId: row.org_id,
    receiverId: row.receiver_id ?? undefined,
    supplierName: row.supplier_name ?? undefined,
    supplierPhone: row.supplier_phone ?? undefined,
    supplierTaxCode: row.supplier_tax_code ?? undefined,
    receiptDate: row.receipt_date,
    invoiceNo: row.invoice_no ?? undefined,
    totalCost: Number(row.total_cost),
    notes: row.notes ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function itemFromRow(row: GoodsReceiptItemRow): GoodsReceiptItem {
  return {
    id: row.id,
    receiptId: row.receipt_id,
    productId: row.product_id ?? undefined,
    productName: row.product_name,
    unit: row.unit,
    quantity: Number(row.quantity),
    priceBuy: Number(row.price_buy),
    lineTotal: Number(row.line_total),
  };
}

/**
 * Pull window default: 30 ngày gần nhất.
 * Long-range query (báo cáo năm) defer Phase 3+.
 */

/**
 * Cost variance threshold — > 20% lệch so với trung bình 5 lần trước → cảnh báo.
 * Hardcoded; tunable defer Phase 3+ qua Settings.
 */
export const COST_VARIANCE_THRESHOLD = 0.2;

class InventorySync {
  private poller = new Poller<GoodsReceiptRow>({
    table: "goods_receipts",
    apply: async (rows) => {
      for (const row of rows) {
        const incoming = fromRow(row);
        const existing = await db.goodsReceipts.get(incoming.id);
        // LWW: bản ghi lạc quan ở local có thể mới hơn ảnh chụp từ server
        if (existing && existing.updatedAt >= incoming.updatedAt) continue;
        await db.goodsReceipts.put(incoming);
      }
    },
    watermarkOf: (rows) => maxUpdatedAt(rows),
  });
  private pulledOrgs: Set<string> = new Set();

  /**
   * Tạo phiếu nhập: optimistic ghi Dexie ngay (receipt + items + stock += +
   * price_buy overwrite) + enqueue outbox 'goods_receipt.create'.
   *
   * UX: page hiển thị "Đã nhập kho" ngay sau Promise resolve, không đợi RPC.
   * Outbox worker sẽ replay nếu offline.
   *
   * @returns receiptId (UUID v4 client-gen)
   */
  async createReceipt(
    orgId: string,
    input: ReceiveInput,
    items: ReceiveItemInput[],
  ): Promise<string> {
    const now = Date.now();
    const receiptId = crypto.randomUUID();
    const totalCost = items.reduce(
      (sum, it) => sum + Math.round(it.priceBuy * it.quantity),
      0,
    );

    const receipt: GoodsReceipt = {
      id: receiptId,
      orgId,
      supplierName: input.supplierName?.trim() || undefined,
      supplierPhone: input.supplierPhone?.trim() || undefined,
      supplierTaxCode: input.supplierTaxCode?.trim() || undefined,
      receiptDate: input.receiptDate,
      invoiceNo: input.invoiceNo?.trim() || undefined,
      totalCost,
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const receiptItems: GoodsReceiptItem[] = items.map((it) => ({
      id: crypto.randomUUID(),
      receiptId,
      productId: it.productId,
      productName: it.productName,
      unit: it.unit,
      quantity: it.quantity,
      priceBuy: Math.round(it.priceBuy),
      lineTotal: Math.round(it.priceBuy * it.quantity),
    }));

    await db.transaction(
      "rw",
      db.goodsReceipts,
      db.goodsReceiptItems,
      db.products,
      db.outbox,
      async () => {
        await db.goodsReceipts.add(receipt);
        if (receiptItems.length) {
          await db.goodsReceiptItems.bulkAdd(receiptItems);
        }
        // Increment Dexie stock + overwrite price_buy với giá nhập mới nhất
        // (Q1 đã chốt: overwrite, lịch sử trong items)
        for (const it of receiptItems) {
          if (!it.productId) continue;
          const p = await db.products.get(it.productId);
          if (p) {
            await db.products.update(it.productId, {
              stock: p.stock + it.quantity,
              priceCost: it.priceBuy,
              updatedAt: now,
            });
          }
        }

        // Outbox payload — snake_case + ISO timestamps cho RPC server
        const receiptPayload = {
          id: receipt.id,
          org_id: receipt.orgId,
          supplier_name: receipt.supplierName ?? null,
          supplier_phone: receipt.supplierPhone ?? null,
          supplier_tax_code: receipt.supplierTaxCode ?? null,
          supplier_id: input.supplierId ?? null,
          receipt_date: receipt.receiptDate,
          invoice_no: receipt.invoiceNo ?? null,
          total_cost: receipt.totalCost,
          notes: receipt.notes ?? null,
          due_date: input.dueDate ?? null,
          created_at: new Date(receipt.createdAt).toISOString(),
        };
        // Gửi kèm cách gõ gốc (mấy thùng, giá mỗi thùng) để SERVER tự quy đổi.
        // Không tin con số client tính sẵn — hai bên lệch nhau là sai tồn kho.
        const itemsPayload = receiptItems.map((it, i) => ({
          id: it.id,
          product_id: it.productId ?? null,
          product_name: it.productName,
          unit: it.unit,
          quantity: it.quantity,
          price_buy: it.priceBuy,
          line_total: it.lineTotal,
          pack_qty: items[i]?.packQty ?? null,
          pack_size: items[i]?.packSize ?? null,
          pack_unit: items[i]?.packUnit ?? null,
          pack_price: items[i]?.packPrice ?? null,
          is_gift: items[i]?.isGift ?? false,
        }));

        const job: OutboxJob = {
          id: crypto.randomUUID(),
          type: "goods_receipt.create",
          payload: { receipt: receiptPayload, items: itemsPayload },
          attempts: 0,
          nextRunAt: now,
          createdAt: now,
        };
        await db.outbox.add(job);
      },
    );

    return receiptId;
  }

  /**
   * Pull receipts theo since (default 30 ngày gần nhất).
   * KHÔNG embed items — pull on demand khi user mở detail (giống order_items).
   */
  // Tham số sinceMs giữ lại cho tương thích với chỗ gọi cũ nhưng không dùng
  // nữa: server trả sẵn theo thứ tự receipt_date giảm dần với giới hạn 1000
  // dòng, mà một tiệm tạp hóa nhập hàng vài lần một tuần thì con số đó là
  // nhiều năm lịch sử. Lọc thêm chỉ tốn thêm một tham số phải bảo trì.
  async pullReceipts(orgId: string, _sinceMs?: number): Promise<void> {
    if (!orgId) return;
    const rows = await api.list<GoodsReceiptRow>("goods_receipts", { org_id: orgId });
    const receipts = rows.map(fromRow);
    await db.goodsReceipts.bulkPut(receipts);
    this.pulledOrgs.add(orgId);
    if (import.meta.env.DEV) {
      console.log(
        `[inventory-sync] pulled ${receipts.length} receipts for org ${orgId}`,
      );
    }
  }

  async pullReceiptsIfNeeded(orgId: string): Promise<void> {
    if (this.pulledOrgs.has(orgId)) return;
    await this.pullReceipts(orgId);
  }

  /**
   * Pull items của 1 receipt — Dexie cache check trước, fallback Supabase.
   * Receipt items immutable theo design (không có UPDATE/DELETE policy) →
   * cache lifetime = session, không cần invalidation.
   */
  async pullReceiptItems(receiptId: string): Promise<GoodsReceiptItem[]> {
    const cached = await db.goodsReceiptItems
      .where("receiptId")
      .equals(receiptId)
      .toArray();
    if (cached.length > 0) return cached;

    const rows = await api.list<GoodsReceiptItemRow>("goods_receipt_items", {
      receipt_id: receiptId,
    });
    const items = rows.map(itemFromRow);
    if (items.length) await db.goodsReceiptItems.bulkPut(items);
    return items;
  }

  /** Theo dõi phiếu nhập từ máy khác. Chi tiết phiếu vẫn kéo khi mở xem. */
  startPolling(orgId: string): void {
    this.poller.start(orgId);
    if (import.meta.env.DEV) {
      console.log(`[inventory-sync] bắt đầu poll cho org ${orgId}`);
    }
  }

  syncNow(): Promise<void> {
    return this.poller.tick();
  }

  stopAndReset(): void {
    this.poller.stop();
    this.pulledOrgs.clear();
  }

  /**
   * Cost variance từ 5 lần nhập gần nhất của product.
   * Dexie không có JOIN → query items + lookup parent receipt cho timestamp.
   *
   * @returns null nếu < 2 history rows (chưa đủ data so sánh)
   */
  async getCostVariance(
    productId: string,
  ): Promise<{ avgRecent: number; lastPrice: number } | null> {
    if (!productId) return null;
    const items = await db.goodsReceiptItems
      .where("productId")
      .equals(productId)
      .toArray();
    if (items.length < 2) return null;

    // Lookup parent receipts để sort theo createdAt
    const receiptIds = Array.from(new Set(items.map((it) => it.receiptId)));
    const receipts = await db.goodsReceipts.bulkGet(receiptIds);
    const receiptCreatedAt = new Map<string, number>();
    receipts.forEach((r) => {
      if (r) receiptCreatedAt.set(r.id, r.createdAt);
    });

    // Sort items theo createdAt desc, top 5
    const sorted = items
      .map((it) => ({
        ...it,
        createdAt: receiptCreatedAt.get(it.receiptId) ?? 0,
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 5);

    if (sorted.length < 2) return null;
    const lastPrice = sorted[0].priceBuy;
    // avg của các lần TRƯỚC (loại lần gần nhất ra để so sánh)
    const previousLines = sorted.slice(1);
    const avgRecent =
      previousLines.reduce((sum, it) => sum + it.priceBuy, 0) /
      previousLines.length;
    return { avgRecent, lastPrice };
  }
}

export const inventorySync = new InventorySync();
