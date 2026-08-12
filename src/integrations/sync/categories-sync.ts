import { db } from "@/lib/db";
import type { Category } from "@/types";
import { api } from "@/integrations/api";
import { productsSync } from "@/integrations/sync/products-sync";

interface CategoryRow {
  id: string;
  org_id: string;
  name: string;
  display_order: number;
  created_at: string;
  updated_at: string;
}

function fromRow(row: CategoryRow): Category {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    displayOrder: row.display_order,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

// Danh mục ít thay đổi và mỗi tiệm chỉ có vài chục dòng, nên poll thưa.
const POLL_MS = 60_000;

/**
 * Đồng bộ danh mục — đi thẳng qua RPC, KHÔNG qua outbox, vì chủ tiệm quản lý
 * trực tiếp và cần thấy kết quả ngay.
 *
 * Khác các module khác: mỗi nhịp poll kéo TOÀN BỘ danh mục của tiệm chứ không
 * kéo tăng dần theo updated_at. Lý do: danh mục bị xoá ở máy khác thì bản kéo
 * tăng dần không bao giờ biết, mà xoá danh mục là thao tác có thật ở đây. Vài
 * chục dòng thì kéo hết cũng không tốn gì.
 */
class CategoriesSync {
  private pulledOrgs: Set<string> = new Set();
  private timer: number | null = null;
  private orgId: string | null = null;

  async pullCategories(orgId: string): Promise<void> {
    if (!orgId) return;
    const rows = await api.list<CategoryRow>("categories", { org_id: orgId });
    const cats = rows.map(fromRow);
    // Thay nguyên cụm để danh mục đã xoá không còn sót lại trong cache
    await db.transaction("rw", db.categories, async () => {
      await db.categories.where("orgId").equals(orgId).delete();
      if (cats.length) await db.categories.bulkPut(cats);
    });
    this.pulledOrgs.add(orgId);
    if (import.meta.env.DEV) {
      console.log(`[categories-sync] đã kéo ${cats.length} danh mục cho org ${orgId}`);
    }
  }

  async pullCategoriesIfNeeded(orgId: string): Promise<void> {
    if (this.pulledOrgs.has(orgId)) return;
    await this.pullCategories(orgId);
  }

  startPolling(orgId: string): void {
    if (this.orgId === orgId && this.timer !== null) return;
    this.stopAndReset();
    this.orgId = orgId;
    this.timer = window.setInterval(() => {
      if (!navigator.onLine) return;
      void this.pullCategories(orgId).catch(() => undefined);
    }, POLL_MS);
  }

  stopAndReset(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.orgId = null;
    this.pulledOrgs.clear();
  }

  // ---- Thao tác qua RPC ----

  /** Tạo danh mục. Server idempotent theo (org, tên) nên gọi lại trả cùng id. */
  async create(orgId: string, name: string): Promise<string> {
    const id = await api.rpc<string>("create_category", { p_org_id: orgId, p_name: name });
    await this.pullCategories(orgId);
    return id;
  }

  /**
   * Đổi tên — server cascade sang products.category. Phải kéo lại products
   * ngay, nếu không màn hình lọc theo danh mục sẽ hiện tên cũ cho tới nhịp poll
   * kế tiếp.
   */
  async rename(id: string, newName: string): Promise<void> {
    await api.rpc("update_category", { p_id: id, p_new_name: newName, p_new_order: null });
    const cat = await db.categories.get(id);
    if (cat) {
      await this.pullCategories(cat.orgId);
      await productsSync.pullProducts(cat.orgId).catch(() => undefined);
    }
  }

  async changeOrder(id: string, newOrder: number): Promise<void> {
    await api.rpc("update_category", { p_id: id, p_new_name: null, p_new_order: newOrder });
    const cat = await db.categories.get(id);
    if (cat) await this.pullCategories(cat.orgId);
  }

  /** Xoá — server set products.category = NULL, sản phẩm mồ côi rơi vào "Khác". */
  async delete(id: string): Promise<void> {
    const cat = await db.categories.get(id);
    await api.rpc("delete_category", { p_id: id });
    if (cat) {
      await this.pullCategories(cat.orgId);
      await productsSync.pullProducts(cat.orgId).catch(() => undefined);
    }
  }

  async reorder(orgId: string, orderedIds: string[]): Promise<void> {
    await api.rpc("reorder_categories", { p_org_id: orgId, p_ordered_ids: orderedIds });
    await this.pullCategories(orgId);
  }
}

export const categoriesSync = new CategoriesSync();
