import { db } from "@/lib/db";
import type { Product } from "@/types";
import { api } from "@/integrations/api";
import { Poller, maxUpdatedAt } from "@/integrations/sync/poller";
import type { OutboxJob } from "@/integrations/shared/queue";

/**
 * Hàng products từ API (snake_case, khớp cột Postgres).
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
 * Convert: row API → Dexie Product (camelCase + thuế dạng phân số + epoch ms).
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
  // Track org đã pull để tránh re-fetch khi switch back
  private pulledOrgs: Set<string> = new Set();

  /**
   * Áp các hàng nhận từ server về Dexie theo LWW (last-write-wins) trên
   * updated_at.
   *
   * Vì sao phải so updated_at chứ không ghi đè thẳng: PaymentSheet trừ kho
   * lạc quan ở local ngay khi thanh toán, nếu server trả về một ảnh chụp cũ
   * hơn thì ghi đè sẽ làm tồn kho "nhảy lùi" trước mắt thu ngân.
   */
  private async applyRows(rows: ProductRow[]): Promise<void> {
    for (const row of rows) {
      const incoming = fromRow(row);
      const existing = await db.products.get(incoming.id);
      if (existing && existing.updatedAt >= incoming.updatedAt) continue;
      await db.products.put(incoming);
    }
  }

  private poller = new Poller<ProductRow>({
    table: "products",
    apply: (rows) => this.applyRows(rows),
    watermarkOf: (rows) => maxUpdatedAt(rows),
  });

  /**
   * Kéo toàn bộ products của org về Dexie. Idempotent — gọi lại nhiều lần OK.
   */
  async pullProducts(orgId: string): Promise<void> {
    if (!orgId) return;
    const rows = await api.list<ProductRow>("products", { org_id: orgId });
    await db.products.bulkPut(rows.map(fromRow));
    this.pulledOrgs.add(orgId);
    if (import.meta.env.DEV) {
      console.log(`[products-sync] đã kéo ${rows.length} sản phẩm cho org ${orgId}`);
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
   * Bật theo dõi thay đổi từ máy khác trong cùng tiệm.
   *
   * Thay cho realtime websocket của Supabase: poll theo updated_at mỗi 20 giây,
   * cộng thêm kéo ngay khi user quay lại tab hoặc mạng vừa có lại. Sản phẩm bị
   * XOÁ ở máy khác sẽ không biến mất ngay — nhưng app chỉ soft-delete
   * (is_active=false) chứ không xoá thật, nên hàng đã archive vẫn về đúng qua
   * poll.
   */
  startPolling(orgId: string): void {
    this.poller.start(orgId);
    if (import.meta.env.DEV) {
      console.log(`[products-sync] bắt đầu poll cho org ${orgId}`);
    }
  }

  /** Kéo ngay một nhịp, dùng sau khi outbox vừa đẩy xong. */
  syncNow(): Promise<void> {
    return this.poller.tick();
  }

  /** Dừng poll + xoá cache khi đăng xuất. */
  stopAndReset(): void {
    this.poller.stop();
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
