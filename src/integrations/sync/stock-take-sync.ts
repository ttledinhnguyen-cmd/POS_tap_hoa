import type { RealtimeChannel } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import type { StockTake, StockTakeItem } from "@/types";
import { supabase } from "@/integrations/supabase";
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

const PULL_WINDOW_MS = 30 * 24 * 3600 * 1000;

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
  private channel: RealtimeChannel | null = null;
  private subscribedOrgId: string | null = null;
  private pulledOrgs: Set<string> = new Set();

  async pullStockTakes(orgId: string, sinceMs?: number): Promise<void> {
    if (!orgId) return;
    const since = new Date(sinceMs ?? Date.now() - PULL_WINDOW_MS)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await supabase
      .from("stock_takes")
      .select("*")
      .eq("org_id", orgId)
      .gte("take_date", since)
      .order("take_date", { ascending: false });
    if (error) {
      console.error("[stock-take-sync] pull failed:", error.message);
      throw error;
    }
    const rows = (data ?? []) as StockTakeRow[];
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
    const { data, error } = await supabase
      .from("stock_take_items")
      .select("*")
      .eq("stock_take_id", takeId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as StockTakeItemRow[];
    const items = rows.map(itemFromRow);
    // Replace cache
    await db.transaction("rw", db.stockTakeItems, async () => {
      await db.stockTakeItems.where("stockTakeId").equals(takeId).delete();
      if (items.length) await db.stockTakeItems.bulkPut(items);
    });
    return items;
  }

  subscribeRealtime(orgId: string): void {
    if (this.subscribedOrgId === orgId) return;
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    this.subscribedOrgId = orgId;
    this.channel = supabase
      .channel(`stock-takes:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "stock_takes",
          filter: `org_id=eq.${orgId}`,
        },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            if (old?.id) {
              await db.transaction(
                "rw",
                db.stockTakes,
                db.stockTakeItems,
                async () => {
                  await db.stockTakes.delete(old.id!);
                  await db.stockTakeItems
                    .where("stockTakeId")
                    .equals(old.id!)
                    .delete();
                },
              );
            }
            return;
          }
          const row = payload.new as StockTakeRow;
          if (!row?.id) return;
          const incoming = fromRow(row);
          const existing = await db.stockTakes.get(incoming.id);
          if (existing && existing.updatedAt >= incoming.updatedAt) return;
          await db.stockTakes.put(incoming);
        },
      )
      .subscribe();
    if (import.meta.env.DEV) {
      console.log(`[stock-take-sync] subscribed realtime for org ${orgId}`);
    }
  }

  unsubscribeAndReset(): void {
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    this.subscribedOrgId = null;
    this.pulledOrgs.clear();
  }

  // -------------------------------------------------------------------------
  // RPC actions — direct call, không qua outbox (owner đang đếm cần feedback)
  // -------------------------------------------------------------------------

  async createStockTake(orgId: string, notes?: string): Promise<string> {
    const { data, error } = await supabase.rpc("create_stock_take", {
      p_org_id: orgId,
      p_notes: notes ?? null,
    });
    if (error) throw error;
    return data as string;
  }

  async addItem(
    takeId: string,
    productId: string,
    actualCount: number,
    reason?: string,
  ): Promise<string> {
    const { data, error } = await supabase.rpc("add_stock_take_item", {
      p_take_id: takeId,
      p_product_id: productId,
      p_actual_count: actualCount,
      p_reason: reason ?? null,
    });
    if (error) throw error;
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
    const { error } = await supabase.rpc("update_stock_take_item", {
      p_item_id: itemId,
      p_actual_count: actualCount,
      p_reason: reason ?? null,
    });
    if (error) throw error;
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
    const { error } = await supabase.rpc("remove_stock_take_item", {
      p_item_id: itemId,
    });
    if (error) throw error;
    if (item) {
      await Promise.all([
        this.pullStockTakeItems(item.stockTakeId),
        this.pullStockTakeHeader(item.stockTakeId),
      ]);
    }
  }

  async commit(takeId: string): Promise<void> {
    const { error } = await supabase.rpc("commit_stock_take", {
      p_take_id: takeId,
    });
    if (error) throw error;
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
    const { error } = await supabase.rpc("cancel_stock_take", {
      p_take_id: takeId,
    });
    if (error) throw error;
    await this.pullStockTakeHeader(takeId);
  }

  /** Refetch 1 take header (sau RPC mutate) — re-query Supabase. */
  async pullStockTakeHeader(takeId: string): Promise<void> {
    const { data, error } = await supabase
      .from("stock_takes")
      .select("*")
      .eq("id", takeId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return;
    await db.stockTakes.put(fromRow(data as StockTakeRow));
  }
}

export const stockTakeSync = new StockTakeSync();
