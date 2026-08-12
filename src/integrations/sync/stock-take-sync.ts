import { Poller, maxUpdatedAt } from "@/integrations/sync/poller";
import { db } from "@/lib/db";
import type { StockTake, StockTakeItem } from "@/types";
import { api } from "@/integrations/api";
import { productsSync } from "@/integrations/sync/products-sync";

interface StockTakeRow {
  id: string;
  org_id: string;
  taker_id: string | null;
  take_date: string; // YYYY-MM-DD
  status: "in_progress" | "committed" | "cancelled";
  notes: string | null;
  total_delta_value: number;
  total_items_count: number;
  created_at: string;
  updated_at: string;
}

interface StockTakeItemRow {
  id: string;
  stock_take_id: string;
  product_id: string | null;
  product_name: string;
  unit: string;
  expected_stock: number;
  actual_count: number;
  delta: number;
  reason: string | null;
  unit_cost: number;
  delta_value: number;
  created_at: string;
}

function fromRow(row: StockTakeRow): StockTake {
  return {
    id: row.id,
    orgId: row.org_id,
    takerId: row.taker_id ?? undefined,
    takeDate: row.take_date,
    status: row.status,
    notes: row.notes ?? undefined,
    totalDeltaValue: Number(row.total_delta_value),
    totalItemsCount: row.total_items_count,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function itemFromRow(row: StockTakeItemRow): StockTakeItem {
  return {
    id: row.id,
    stockTakeId: row.stock_take_id,
    productId: row.product_id ?? undefined,
    productName: row.product_name,
    unit: row.unit,
    expectedStock: Number(row.expected_stock),
    actualCount: Number(row.actual_count),
    delta: Number(row.delta),
    reason: (row.reason as StockTakeItem["reason"]) ?? undefined,
    unitCost: Number(row.unit_cost),
    deltaValue: Number(row.delta_value),
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * Stock take sync — RPC-driven (KHÔNG outbox vì owner đứng đếm hàng cần
 * realtime sync giữa actual_count input và parent totals).
 *
 * Workflow:
 *   - createStockTake → RPC returns id → navigate detail
 *   - addItem/updateItem/removeItem → RPC, server tự recompute totals
 *   - commit → RPC apply UPDATE products.stock = actual + status='committed'
 *   - Sau commit gọi productsSync.pullProducts để Dexie sync stock mới
 */
class StockTakeSync {
  private pulledOrgs: Set<string> = new Set();

  private poller = new Poller<StockTakeRow>({
    table: "stock_takes",
    apply: async (rows) => {
      for (const row of rows) {
        const incoming = fromRow(row);
        const existing = await db.stockTakes.get(incoming.id);
        if (existing && existing.updatedAt >= incoming.updatedAt) continue;
        await db.stockTakes.put(incoming);
      }
    },
    watermarkOf: (rows) => maxUpdatedAt(rows),
  });

  // sinceMs không còn dùng: server trả theo take_date giảm dần, giới hạn 1000
  // dòng — thừa sức cho lịch sử kiểm kê của một tiệm.
  async pullStockTakes(orgId: string, _sinceMs?: number): Promise<void> {
    if (!orgId) return;
    const rows = await api.list<StockTakeRow>("stock_takes", { org_id: orgId });
    const takes = rows.map(fromRow);
    await db.stockTakes.bulkPut(takes);
    this.pulledOrgs.add(orgId);
    if (import.meta.env.DEV) {
      console.log(
        `[stock-take-sync] pulled ${takes.length} takes for org ${orgId}`,
      );
    }
  }

  async pullStockTakesIfNeeded(orgId: string): Promise<void> {
    if (this.pulledOrgs.has(orgId)) return;
    await this.pullStockTakes(orgId);
  }

  /** Pull items của 1 take. KHÔNG cache check vì items có thể đổi (in_progress). */
  async pullStockTakeItems(takeId: string): Promise<StockTakeItem[]> {
    const rows = await api.list<StockTakeItemRow>("stock_take_items", {
      stock_take_id: takeId,
    });
    const items = rows.map(itemFromRow);
    // Replace cache
    await db.transaction("rw", db.stockTakeItems, async () => {
      await db.stockTakeItems.where("stockTakeId").equals(takeId).delete();
      if (items.length) await db.stockTakeItems.bulkPut(items);
    });
    return items;
  }

  startPolling(orgId: string): void {
    this.poller.start(orgId);
    if (import.meta.env.DEV) {
      console.log(`[stock-take-sync] bắt đầu poll cho org ${orgId}`);
    }
  }

  syncNow(): Promise<void> {
    return this.poller.tick();
  }

  stopAndReset(): void {
    this.poller.stop();
    this.pulledOrgs.clear();
  }

  // -------------------------------------------------------------------------
  // RPC actions — direct call, không qua outbox (owner đang đếm cần feedback)
  // -------------------------------------------------------------------------

  async createStockTake(orgId: string, notes?: string): Promise<string> {
    const data = await api.rpc<string>("create_stock_take", {
      p_org_id: orgId,
      p_notes: notes ?? null,
    });
    return data as string;
  }

  async addItem(
    takeId: string,
    productId: string,
    actualCount: number,
    reason?: string,
  ): Promise<string> {
    const data = await api.rpc<string>("add_stock_take_item", {
      p_take_id: takeId,
      p_product_id: productId,
      p_actual_count: actualCount,
      p_reason: reason ?? null,
    });
    // Refetch items + parent totals
    await Promise.all([
      this.pullStockTakeItems(takeId),
      this.pullStockTakeHeader(takeId),
    ]);
    return data as string;
  }

  async updateItem(
    itemId: string,
    actualCount: number,
    reason?: string,
  ): Promise<void> {
    await api.rpc("update_stock_take_item", {
      p_item_id: itemId,
      p_actual_count: actualCount,
      p_reason: reason ?? null,
    });
    // Lookup take_id từ Dexie để refetch
    const item = await db.stockTakeItems.get(itemId);
    if (item) {
      await Promise.all([
        this.pullStockTakeItems(item.stockTakeId),
        this.pullStockTakeHeader(item.stockTakeId),
      ]);
    }
  }

  async removeItem(itemId: string): Promise<void> {
    const item = await db.stockTakeItems.get(itemId);
    await api.rpc("remove_stock_take_item", {
      p_item_id: itemId,
    });
    if (item) {
      await Promise.all([
        this.pullStockTakeItems(item.stockTakeId),
        this.pullStockTakeHeader(item.stockTakeId),
      ]);
    }
  }

  async commit(takeId: string): Promise<void> {
    await api.rpc("commit_stock_take", {
      p_take_id: takeId,
    });
    // Refetch take + products (stock đã đổi)
    await this.pullStockTakeHeader(takeId);
    const take = await db.stockTakes.get(takeId);
    if (take) {
      await productsSync.pullProducts(take.orgId).catch(() => {
        /* swallow */
      });
    }
  }

  async cancel(takeId: string): Promise<void> {
    await api.rpc("cancel_stock_take", {
      p_take_id: takeId,
    });
    await this.pullStockTakeHeader(takeId);
  }

  /** Kéo lại header của một phiếu sau khi RPC vừa đổi tổng. */
  async pullStockTakeHeader(takeId: string): Promise<void> {
    const rows = await api.list<StockTakeRow>("stock_takes", { id: takeId });
    if (rows.length === 0) return;
    await db.stockTakes.put(fromRow(rows[0]));
  }
}

export const stockTakeSync = new StockTakeSync();
