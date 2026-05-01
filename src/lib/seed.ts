import { db } from "@/lib/db";
import { productsSync } from "@/integrations/sync/products-sync";
import { outboxWorker } from "@/integrations/sync/outbox-worker";
import type { Product } from "@/types";

type SeedItem = Omit<
  Product,
  "id" | "orgId" | "isActive" | "createdAt" | "updatedAt"
>;

/**
 * Sản phẩm mẫu — các mặt hàng tạp hóa Việt Nam phổ biến.
 * Mã vạch là EAN-13 thật của sản phẩm bán trên thị trường VN
 * để có thể test bằng cách quét gói thật trong nhà.
 */
const SEED_PRODUCTS: SeedItem[] = [
  {
    barcode: "8934563138165",
    name: "Mì Hảo Hảo tôm chua cay",
    unit: "gói",
    priceSell: 5000,
    priceCost: 4200,
    stock: 120,
    taxRate: 0.08,
    category: "Mì gói",
  },
  {
    barcode: "8934673001113",
    name: "Sữa Vinamilk 100% có đường 180ml",
    unit: "hộp",
    priceSell: 9500,
    priceCost: 8200,
    stock: 48,
    taxRate: 0.08,
    category: "Sữa",
  },
  {
    barcode: "8936036020014",
    name: "Nước suối Lavie 500ml",
    unit: "chai",
    priceSell: 6000,
    priceCost: 4800,
    stock: 60,
    taxRate: 0.08,
    category: "Nước",
  },
  {
    barcode: "8934588063053",
    name: "Coca-Cola lon 320ml",
    unit: "lon",
    priceSell: 12000,
    priceCost: 9500,
    stock: 36,
    taxRate: 0.08,
    category: "Nước ngọt",
  },
  {
    barcode: "8935039570014",
    name: "Bánh Oreo nguyên bản 137g",
    unit: "gói",
    priceSell: 18000,
    priceCost: 14500,
    stock: 24,
    taxRate: 0.08,
    category: "Bánh kẹo",
  },
  {
    barcode: "8934868128106",
    name: "Kẹo cao su Doublemint 14g",
    unit: "vỉ",
    priceSell: 8000,
    priceCost: 6200,
    stock: 80,
    taxRate: 0.08,
    category: "Bánh kẹo",
  },
  {
    barcode: "8936017360073",
    name: "Dầu ăn Tường An 1L",
    unit: "chai",
    priceSell: 52000,
    priceCost: 46000,
    stock: 18,
    taxRate: 0.08,
    category: "Gia vị",
  },
  {
    barcode: "8934822101015",
    name: "Nước mắm Nam Ngư 750ml",
    unit: "chai",
    priceSell: 35000,
    priceCost: 30000,
    stock: 22,
    taxRate: 0.08,
    category: "Gia vị",
  },
  {
    barcode: "8934707012101",
    name: "Bột giặt Omo 800g",
    unit: "túi",
    priceSell: 65000,
    priceCost: 58000,
    stock: 12,
    taxRate: 0.08,
    category: "Đồ gia dụng",
  },
  {
    barcode: "8934868047001",
    name: "Bàn chải đánh răng P/S",
    unit: "cái",
    priceSell: 18000,
    priceCost: 13500,
    stock: 30,
    taxRate: 0,
    category: "Vệ sinh",
  },
  {
    barcode: "8935024141014",
    name: "Trứng gà công nghiệp",
    unit: "quả",
    priceSell: 3500,
    priceCost: 2800,
    stock: 200,
    taxRate: 0,
    category: "Tươi sống",
  },
  {
    barcode: "8934803012116",
    name: "Gạo ST25 (5kg)",
    unit: "túi",
    priceSell: 165000,
    priceCost: 145000,
    stock: 8,
    taxRate: 0.05,
    category: "Gạo",
  },
];

/**
 * Polish task (sau Phase 5): seed đi qua productsSync.upsertProduct để
 * Dexie + Supabase đồng bộ. Tránh gotcha FK violation order_items.product_id
 * khi user thanh toán seed product (Phase 5 phát hiện).
 *
 * Seed CHỈ chạy khi:
 *   - Mode DEV (Vite import.meta.env.DEV)
 *   - User đã thuộc org (orgId truyền vào)
 *   - Org đó chưa có product nào trong Dexie
 *
 * Production user signup mới sẽ thấy empty list, dùng "Thêm sản phẩm" để build.
 *
 * Drain outbox ngay khi online → đảm bảo Supabase có 12 products trước khi
 * user kịp click thanh toán đầu tiên.
 */
export async function seedIfEmptyForOrg(orgId: string): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (!orgId) return;

  const count = await db.products.where("orgId").equals(orgId).count();
  if (count > 0) return;

  console.log(`[seed] DEV: seeding ${SEED_PRODUCTS.length} products for org ${orgId}`);

  // upsertProduct: ghi Dexie + enqueue outbox (sync lên Supabase)
  for (const seedItem of SEED_PRODUCTS) {
    await productsSync.upsertProduct(orgId, {
      barcode: seedItem.barcode,
      name: seedItem.name,
      unit: seedItem.unit,
      priceCost: seedItem.priceCost,
      priceSell: seedItem.priceSell,
      stock: seedItem.stock,
      taxRate: seedItem.taxRate,
      category: seedItem.category,
    });
  }

  // Drain ngay để Supabase có đủ 12 products trước khi user thanh toán đầu tiên.
  // Tránh FK violation order_items.product_id (Phase 5 gotcha đã fix).
  // BATCH_SIZE=5 nên drainNow() chỉ xử lý 5 jobs/lần — loop tới khi hết
  // pending jobs hoặc max 5 lần (tránh vô hạn).
  if (navigator.onLine) {
    for (let i = 0; i < 5; i++) {
      await outboxWorker.drainNow();
      // toArray + filter — Dexie indexed `where('status')` skip rows có
      // status=undefined (job mới chưa xử lý nên field chưa set), nên
      // .count() qua index sẽ thiếu. Dùng toArray + filter trên data tươi.
      const all = await db.outbox.toArray();
      const stillPending = all.filter(
        (j) => j.status !== "done" && j.status !== "failed",
      ).length;
      if (stillPending === 0) break;
    }
  }
}
