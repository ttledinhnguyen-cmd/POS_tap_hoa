import { api } from "@/integrations/api";

export interface BarcodeInfo {
  source: "shared" | "openfoodfacts";
  barcode: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  defaultUnit?: string;
  category?: string;
}

const OFF_TIMEOUT_MS = 3000;

/**
 * Validate + normalize barcode (strip whitespace, allow 8-14 digits).
 * Returns null nếu không phải EAN/UPC.
 */
function normalize(barcode: string): string | null {
  const clean = barcode.trim().replace(/\s/g, "");
  if (!/^\d{8,14}$/.test(clean)) return null;
  return clean;
}

/**
 * Lookup barcode → product info từ:
 *   1. Supabase shared_barcodes (kho cộng đồng VN, ưu tiên cao)
 *   2. Open Food Facts (fallback cho hàng global brand)
 *
 * Trả null nếu không tìm thấy ở cả 2 nguồn HOẶC barcode invalid.
 * Network/timeout error → fail silently (return null, không throw).
 *
 * KHÔNG lưu giá — chỉ name/brand/image/unit. Giá là bí mật mỗi shop.
 */
export async function lookupBarcode(barcode: string): Promise<BarcodeInfo | null> {
  const clean = normalize(barcode);
  if (!clean) return null;

  // 1. Kho mã vạch dùng chung trên server mình (nhanh, ưu tiên cao nhất)
  try {
    const rows = await api.list<{
      barcode: string;
      name: string;
      brand: string | null;
      image_url: string | null;
      default_unit: string | null;
      category: string | null;
    }>("shared_barcodes", { barcode: clean });
    const data = rows[0];
    if (data) {
      return {
        source: "shared",
        barcode: data.barcode,
        name: data.name,
        brand: data.brand ?? undefined,
        imageUrl: data.image_url ?? undefined,
        defaultUnit: data.default_unit ?? undefined,
        category: data.category ?? undefined,
      };
    }
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn("[lookupBarcode] shared lookup failed:", e);
    }
  }

  // 2. Open Food Facts fallback
  try {
    const r = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${clean}.json`,
      { signal: AbortSignal.timeout(OFF_TIMEOUT_MS) },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      status?: number;
      product?: {
        product_name_vi?: string;
        product_name_en?: string;
        product_name?: string;
        brands?: string;
        image_front_small_url?: string;
        image_front_url?: string;
        image_url?: string;
        categories?: string;
      };
    };
    if (j.status === 1 && j.product) {
      const name =
        j.product.product_name_vi ||
        j.product.product_name_en ||
        j.product.product_name ||
        "Sản phẩm";
      return {
        source: "openfoodfacts",
        barcode: clean,
        name: name.trim(),
        brand: j.product.brands?.split(",")[0]?.trim() || undefined,
        imageUrl:
          j.product.image_front_small_url ||
          j.product.image_front_url ||
          j.product.image_url ||
          undefined,
        category: j.product.categories?.split(",")[0]?.trim() || undefined,
      };
    }
  } catch {
    // Network/timeout/abort — fail silently. User vẫn nhập tay được.
  }

  return null;
}

/**
 * Đẩy thông tin barcode vào kho cộng đồng (RPC contribute_barcode).
 * Fire-and-forget — không throw lên UI nếu fail (server có rate limit/RLS guard).
 *
 * Source 'shared' cũng nên gọi để increment counter (track "lần encounter").
 * Source 'openfoodfacts' → contribute giúp user VN sau hit cache thay vì OFF.
 */
export async function contributeBarcode(info: {
  barcode: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  defaultUnit?: string;
}): Promise<void> {
  const clean = normalize(info.barcode);
  if (!clean) return;
  if (!info.name.trim()) return;
  try {
    await api.rpc("contribute_barcode", {
      p_barcode: clean,
      p_name: info.name.trim(),
      p_brand: info.brand?.trim() || null,
      p_image_url: info.imageUrl?.trim() || null,
      p_default_unit: info.defaultUnit?.trim() || "cái",
    });
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn("[contributeBarcode] failed:", e);
    }
  }
}
