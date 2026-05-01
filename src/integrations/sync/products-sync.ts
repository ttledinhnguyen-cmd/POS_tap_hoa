import type { RealtimeChannel } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import type { Product } from "@/types";
import { supabase } from "@/integrations/supabase";
import type { OutboxJob } from "@/integrations/shared/queue";

/**
 * Hàng row Supabase products (snake_case).
 */
interface ProductRow {
  id: string;
  org_id: string;
  barcode: string | null;
  name: string;
  unit: string;
  price_buy: number;
  price_sell: number;
  stock: number;
  tax_rate: number; // percent (0|5|8|10)
  category: string | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string; // ISO timestamptz
  updated_at: string;
}

/**
 * Convert: Supabase row → Dexie Product (camelCase + tax fraction + epoch ms).
 */
function fromRow(row: ProductRow): Product {
  return {
    id: row.id,
    orgId: row.org_id,
    barcode: row.barcode ?? "",
    name: row.name,
    unit: row.unit,
    priceSell: Number(row.price_sell),
    priceCost: Number(row.price_buy),
    stock: Number(row.stock),
    taxRate: Number(row.tax_rate) / 100, // 8 → 0.08
    category: row.category ?? undefined,
    imageUrl: row.image_url ?? undefined,
    isActive: row.is_active,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

/**
 * Convert: Dexie Product → Supabase row payload (snake_case + percent).
 * KHÔNG include createdAt/updatedAt — Supabase tự set.
 */
function toRow(p: Product): Omit<ProductRow, "created_at" | "updated_at"> {
  return {
    id: p.id,
    org_id: p.orgId,
    barcode: p.barcode || null,
    name: p.name,
    unit: p.unit,
    price_buy: Math.round(p.priceCost),
    price_sell: Math.round(p.priceSell),
    stock: p.stock,
    tax_rate: Math.round(p.taxRate * 100), // 0.08 → 8
    category: p.category ?? null,
    image_url: p.imageUrl ?? null,
    is_active: p.isActive,
  };
}

/**
 * Input cho upsertProduct UI form (chưa có id/timestamps).
 */
export interface ProductInput {
  id?: string; // optional: nếu edit thì truyền id, nếu add thì auto-gen
  barcode: string;
  name: string;
  unit: string;
  priceSell: number;
  priceCost: number;
  stock: number;
  taxRate: number;
  category?: string;
  imageUrl?: string;
}

class ProductsSync {
  private channel: RealtimeChannel | null = null;
  private subscribedOrgId: string | null = null;
  // Track org đã pull để tránh re-fetch khi switch back
  private pulledOrgs: Set<string> = new Set();

  /**
   * Pull toàn bộ products của org từ Supabase, upsert Dexie.
   * Idempotent — gọi lại nhiều lần OK.
   */
  async pullProducts(orgId: string): Promise<void> {
    if (!orgId) return;
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("org_id", orgId);
    if (error) {
      console.error("[products-sync] pull failed:", error.message);
      throw error;
    }
    const rows = (data ?? []) as ProductRow[];
    const products = rows.map(fromRow);
    await db.products.bulkPut(products);
    this.pulledOrgs.add(orgId);
    if (import.meta.env.DEV) {
      console.log(`[products-sync] pulled ${products.length} products for org ${orgId}`);
    }
  }

  /**
   * Pull chỉ khi org chưa pull lần nào (cache friendly cho switchOrg).
   */
  async pullProductsIfNeeded(orgId: string): Promise<void> {
    if (this.pulledOrgs.has(orgId)) return;
    await this.pullProducts(orgId);
  }

  /**
   * Subscribe realtime channel cho org. Tự unsubscribe channel cũ trước.
   */
  subscribeRealtime(orgId: string): void {
    if (this.subscribedOrgId === orgId) return;
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    this.subscribedOrgId = orgId;
    this.channel = supabase
      .channel(`products:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "products",
          filter: `org_id=eq.${orgId}`,
        },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            if (old?.id) {
              await db.products.delete(old.id);
            }
            return;
          }
          // INSERT or UPDATE — apply LWW theo updated_at để tránh "stock nhảy lùi"
          // khi local đã optimistic update (PaymentSheet decrement) nhưng realtime
          // mang về snapshot cũ hơn (ví dụ event trước commit cuối).
          const row = payload.new as ProductRow;
          if (!row?.id) return;
          const incoming = fromRow(row);
          const existing = await db.products.get(incoming.id);
          if (existing && existing.updatedAt >= incoming.updatedAt) {
            // Local mới hơn hoặc bằng → giữ nguyên, đợi event tiếp theo
            return;
          }
          await db.products.put(incoming);
        },
      )
      .subscribe();
    if (import.meta.env.DEV) {
      console.log(`[products-sync] subscribed realtime for org ${orgId}`);
    }
  }

  /**
   * Cleanup channel + clear pulledOrgs cache khi signOut.
   */
  unsubscribeAndReset(): void {
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    this.subscribedOrgId = null;
    this.pulledOrgs.clear();
  }

  /**
   * Add hoặc Update product. Optimistic UI: ghi Dexie ngay, enqueue outbox để
   * worker drain lên Supabase async.
   *
   * @param orgId   Org hiện tại (current store)
   * @param input   Form data
   * @returns       Product id (mới hoặc existing)
   */
  async upsertProduct(orgId: string, input: ProductInput): Promise<string> {
    const now = Date.now();
    const id = input.id ?? crypto.randomUUID();
    const product: Product = {
      id,
      orgId,
      barcode: input.barcode.trim(),
      name: input.name.trim(),
      unit: input.unit.trim() || "cái",
      priceSell: Math.round(input.priceSell),
      priceCost: Math.round(input.priceCost),
      stock: input.stock,
      taxRate: input.taxRate,
      category: input.category?.trim() || undefined,
      imageUrl: input.imageUrl?.trim() || undefined,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    // Optimistic: ghi Dexie ngay
    await db.products.put(product);

    // Enqueue outbox: full row payload, idempotent qua id
    const job: OutboxJob = {
      id: crypto.randomUUID(),
      type: "product.upsert",
      payload: toRow(product),
      attempts: 0,
      nextRunAt: now,
      createdAt: now,
    };
    await db.outbox.add(job);

    return id;
  }

  /**
   * Soft-delete (archive). Set isActive=false, enqueue update lên server.
   */
  async archiveProduct(orgId: string, id: string): Promise<void> {
    const now = Date.now();
    await db.products.update(id, { isActive: false, updatedAt: now });

    const job: OutboxJob = {
      id: crypto.randomUUID(),
      type: "product.archive",
      payload: { id, org_id: orgId },
      attempts: 0,
      nextRunAt: now,
      createdAt: now,
    };
    await db.outbox.add(job);
  }
}

/**
 * Singleton instance — store + UI components share.
 */
export const productsSync = new ProductsSync();
