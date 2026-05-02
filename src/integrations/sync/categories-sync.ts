import type { RealtimeChannel } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import type { Category } from "@/types";
import { supabase } from "@/integrations/supabase";
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

/**
 * Categories sync — RPC-driven (KHÔNG outbox vì owner manage trực tiếp,
 * cần feedback realtime). Pattern khớp stock-take-sync.
 *
 * Cascade rename: server-side trong RPC update_category, client refetch
 * products qua realtime subscription (products-sync) hoặc force pullProducts
 * sau rename để Dexie sync ngay.
 */
class CategoriesSync {
  private channel: RealtimeChannel | null = null;
  private subscribedOrgId: string | null = null;
  private pulledOrgs: Set<string> = new Set();

  async pullCategories(orgId: string): Promise<void> {
    if (!orgId) return;
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("org_id", orgId)
      .order("display_order", { ascending: true });
    if (error) {
      console.error("[categories-sync] pull failed:", error.message);
      throw error;
    }
    const rows = (data ?? []) as CategoryRow[];
    const cats = rows.map(fromRow);
    // Replace cache: clear org's existing rows trước khi bulkPut để tránh stale
    await db.transaction("rw", db.categories, async () => {
      await db.categories.where("orgId").equals(orgId).delete();
      if (cats.length) await db.categories.bulkPut(cats);
    });
    this.pulledOrgs.add(orgId);
    if (import.meta.env.DEV) {
      console.log(
        `[categories-sync] pulled ${cats.length} categories for org ${orgId}`,
      );
    }
  }

  async pullCategoriesIfNeeded(orgId: string): Promise<void> {
    if (this.pulledOrgs.has(orgId)) return;
    await this.pullCategories(orgId);
  }

  subscribeRealtime(orgId: string): void {
    if (this.subscribedOrgId === orgId) return;
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    this.subscribedOrgId = orgId;
    this.channel = supabase
      .channel(`categories:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "categories",
          filter: `org_id=eq.${orgId}`,
        },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            if (old?.id) await db.categories.delete(old.id);
            return;
          }
          const row = payload.new as CategoryRow;
          if (!row?.id) return;
          const incoming = fromRow(row);
          const existing = await db.categories.get(incoming.id);
          if (existing && existing.updatedAt >= incoming.updatedAt) return;
          await db.categories.put(incoming);
        },
      )
      .subscribe();
    if (import.meta.env.DEV) {
      console.log(`[categories-sync] subscribed realtime for org ${orgId}`);
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

  // ---- RPC actions ----

  /** Tạo category mới (idempotent server-side qua unique). Returns id. */
  async create(orgId: string, name: string): Promise<string> {
    const { data, error } = await supabase.rpc("create_category", {
      p_org_id: orgId,
      p_name: name,
    });
    if (error) throw error;
    // Realtime sẽ fire INSERT; vẫn pull để chắc chắn UI update ngay
    await this.pullCategories(orgId);
    return data as string;
  }

  /**
   * Rename category — server cascade UPDATE products. Sau RPC, force
   * pullProducts để Dexie products đồng bộ ngay (realtime sẽ chỉ fire UPDATE
   * cho từng product → có thể chậm/race).
   */
  async rename(id: string, newName: string): Promise<void> {
    const { error } = await supabase.rpc("update_category", {
      p_id: id,
      p_new_name: newName,
      p_new_order: null,
    });
    if (error) throw error;
    // Refetch category + products
    const cat = await db.categories.get(id);
    if (cat) {
      await this.pullCategories(cat.orgId);
      await productsSync.pullProducts(cat.orgId).catch(() => undefined);
    }
  }

  async changeOrder(id: string, newOrder: number): Promise<void> {
    const { error } = await supabase.rpc("update_category", {
      p_id: id,
      p_new_name: null,
      p_new_order: newOrder,
    });
    if (error) throw error;
    const cat = await db.categories.get(id);
    if (cat) await this.pullCategories(cat.orgId);
  }

  /**
   * Delete category — server SET products.category = NULL cascade. Sau RPC
   * pull products để Dexie nhận products mồ côi (category null → "Khác").
   */
  async delete(id: string): Promise<void> {
    const cat = await db.categories.get(id);
    const { error } = await supabase.rpc("delete_category", { p_id: id });
    if (error) throw error;
    if (cat) {
      await this.pullCategories(cat.orgId);
      await productsSync.pullProducts(cat.orgId).catch(() => undefined);
    }
  }

  async reorder(orgId: string, orderedIds: string[]): Promise<void> {
    const { error } = await supabase.rpc("reorder_categories", {
      p_org_id: orgId,
      p_ordered_ids: orderedIds,
    });
    if (error) throw error;
    await this.pullCategories(orgId);
  }
}

export const categoriesSync = new CategoriesSync();
