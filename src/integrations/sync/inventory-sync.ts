import { db } from "@/lib/db";
import type {
  GoodsReceipt,
  GoodsReceiptItem,
  ReceiveInput,
  ReceiveItemInput,
} from "@/types";
import type { OutboxJob } from "@/integrations/shared/queue";

/**
 * Inventory Sync — Phase 2A (nhập kho).
 *
 * Pattern khớp orders-sync:
 *   - createReceipt: optimistic Dexie write + Dexie products.stock += quantity +
 *     overwrite price_buy + enqueue outbox 'goods_receipt.create' (RPC idempotent)
 *   - pullReceipts / subscribeRealtime / pullReceiptItems: skeleton, defer Phase 2B
 *   - getCostVariance: defer Phase 2B (dùng Dexie cache khi đủ history)
 *
 * Realtime channel cho goods_receipts cũng defer 2B — owner thường nhập 1 phiếu
 * tại 1 thời điểm, không nhiều device cùng lúc, race risk thấp.
 */
class InventorySync {
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
          receipt_date: receipt.receiptDate,
          invoice_no: receipt.invoiceNo ?? null,
          total_cost: receipt.totalCost,
          notes: receipt.notes ?? null,
          created_at: new Date(receipt.createdAt).toISOString(),
        };
        const itemsPayload = receiptItems.map((it) => ({
          id: it.id,
          product_id: it.productId ?? null,
          product_name: it.productName,
          unit: it.unit,
          quantity: it.quantity,
          price_buy: it.priceBuy,
          line_total: it.lineTotal,
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

  // -------------------------------------------------------------------------
  // Skeleton — Phase 2B sẽ implement đầy đủ
  // -------------------------------------------------------------------------

  /** Pull receipts từ Supabase, upsert Dexie. Defer Phase 2B. */
  async pullReceipts(_orgId: string, _since?: Date): Promise<void> {
    // Phase 2B: select * + bulkPut Dexie + LWW
    return;
  }

  /** Subscribe realtime per org. Defer Phase 2B. */
  subscribeRealtime(_orgId: string): void {
    // Phase 2B: postgres_changes channel goods-receipts:{orgId}
    return;
  }

  /** Cleanup channel + clear cache. Defer Phase 2B. */
  unsubscribeAndReset(): void {
    return;
  }

  /** Pull items của 1 receipt. Defer Phase 2B. */
  async pullReceiptItems(_receiptId: string): Promise<GoodsReceiptItem[]> {
    return [];
  }

  /**
   * Cost variance từ 5 lần nhập gần nhất của product. Defer Phase 2B.
   * @returns null nếu < 2 history rows (chưa đủ data so sánh)
   */
  async getCostVariance(
    _productId: string,
  ): Promise<{ avgRecent: number; lastPrice: number } | null> {
    return null;
  }
}

export const inventorySync = new InventorySync();
