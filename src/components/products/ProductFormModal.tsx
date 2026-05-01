import { type FormEvent, lazy, Suspense, useEffect, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Sheet } from "@/components/ui/Sheet";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { RoleGate } from "@/components/RoleGate";
import { productsSync } from "@/integrations/sync/products-sync";
import { outboxWorker } from "@/integrations/sync/outbox-worker";
import { useAuthStore } from "@/stores/auth";
import { db } from "@/lib/db";
import { vibrate } from "@/lib/utils";
import type { Product } from "@/types";

// Lazy: chunk @zxing/browser chỉ load khi user click "Quét"
const BarcodeScanner = lazy(() =>
  import("@/components/BarcodeScanner").then((m) => ({
    default: m.BarcodeScanner,
  })),
);

function ScannerFallback() {
  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center text-white">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">Đang mở camera...</p>
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Khi truyền product → form ở chế độ Edit. Khi null → Add.
   */
  product: Product | null;
}

const TAX_OPTIONS = [
  { value: 0, label: "0% (miễn thuế)" },
  { value: 0.05, label: "5%" },
  { value: 0.08, label: "8% (mặc định 2026)" },
  { value: 0.1, label: "10%" },
];

/**
 * ProductFormModal — Add/Edit. RoleGate ẩn `priceCost` cho cashier.
 */
export function ProductFormModal({ open, onClose, product }: Props) {
  const orgId = useAuthStore((s) => s.currentOrgId);
  const isEdit = product !== null;

  const [barcode, setBarcode] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("cái");
  const [priceSell, setPriceSell] = useState("");
  const [priceCost, setPriceCost] = useState("");
  const [stock, setStock] = useState("");
  const [taxRate, setTaxRate] = useState(0.08);
  const [category, setCategory] = useState("");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Reset form khi mở/đóng hoặc khi đổi product
  useEffect(() => {
    if (!open) return;
    if (product) {
      setBarcode(product.barcode);
      setName(product.name);
      setUnit(product.unit);
      setPriceSell(String(product.priceSell));
      setPriceCost(String(product.priceCost));
      setStock(String(product.stock));
      setTaxRate(product.taxRate);
      setCategory(product.category ?? "");
    } else {
      setBarcode("");
      setName("");
      setUnit("cái");
      setPriceSell("");
      setPriceCost("");
      setStock("");
      setTaxRate(0.08);
      setCategory("");
    }
    setErrors({});
  }, [open, product]);

  // Check trùng barcode (chỉ khi Add hoặc Edit + đổi barcode)
  const duplicateBarcode = useLiveQuery(
    async () => {
      if (!barcode.trim() || !orgId) return null;
      const existing = await db.products
        .where({ orgId, barcode: barcode.trim() })
        .first();
      if (!existing) return null;
      if (isEdit && existing.id === product?.id) return null;
      return existing;
    },
    [barcode, orgId, isEdit, product?.id],
    null,
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;

    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Vui lòng nhập tên sản phẩm";
    if (duplicateBarcode) next.barcode = `Mã vạch đã có ở "${duplicateBarcode.name}"`;
    const ps = Number(priceSell);
    if (!priceSell || Number.isNaN(ps) || ps < 0)
      next.priceSell = "Giá bán phải >= 0";
    const pc = priceCost === "" ? 0 : Number(priceCost);
    if (Number.isNaN(pc) || pc < 0) next.priceCost = "Giá vốn phải >= 0";
    const s = stock === "" ? 0 : Number(stock);
    if (Number.isNaN(s) || s < 0) next.stock = "Tồn kho phải >= 0";

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      await productsSync.upsertProduct(orgId, {
        id: product?.id,
        barcode: barcode.trim(),
        name: name.trim(),
        unit: unit.trim() || "cái",
        priceSell: ps,
        priceCost: pc,
        stock: s,
        taxRate,
        category: category.trim() || undefined,
      });
      // Trigger drain ngay (UX feedback nhanh)
      outboxWorker.drainNow();
      vibrate(15);
      onClose();
    } catch (err) {
      setErrors({
        _form: err instanceof Error ? err.message : "Lưu thất bại, thử lại",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleScanned = (code: string) => {
    setBarcode(code);
    setShowScanner(false);
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={isEdit ? "Sửa sản phẩm" : "Thêm sản phẩm"}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-5 pb-5" noValidate>
          <FormField label="Tên sản phẩm" error={errors.name}>
            <input
              type="text"
              autoFocus={!isEdit}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mì Hảo Hảo tôm chua cay"
            />
          </FormField>

          <FormField label="Mã vạch" optional error={errors.barcode}>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="EAN-13 / UPC"
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="h-touch px-3 rounded-lg border border-line bg-bg-card press flex items-center gap-1.5 text-sm font-medium flex-shrink-0"
                aria-label="Quét mã vạch"
              >
                <Camera className="w-4 h-4" />
                Quét
              </button>
            </div>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Đơn vị">
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="gói, lon, kg..."
              />
            </FormField>
            <FormField label="Tồn kho" error={errors.stock}>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                placeholder="0"
              />
            </FormField>
          </div>

          <RoleGate allow={["owner"]}>
            <FormField label="Giá vốn (đồng)" error={errors.priceCost}>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="500"
                value={priceCost}
                onChange={(e) => setPriceCost(e.target.value)}
                placeholder="0"
              />
            </FormField>
          </RoleGate>

          <FormField label="Giá bán (đồng)" hint="Đã bao gồm thuế" error={errors.priceSell}>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="500"
              value={priceSell}
              onChange={(e) => setPriceSell(e.target.value)}
              placeholder="0"
            />
          </FormField>

          <FormField label="Thuế GTGT">
            <select
              value={String(taxRate)}
              onChange={(e) => setTaxRate(Number(e.target.value))}
              className="w-full px-3 h-touch rounded-lg border border-line bg-bg-card text-ink focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              {TAX_OPTIONS.map((opt) => (
                <option key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Danh mục" optional>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Mì gói, Sữa, Gia vị..."
            />
          </FormField>

          {errors._form && (
            <p className="text-sm text-danger" role="alert">
              {errors._form}
            </p>
          )}

          <div className="flex gap-2 mt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
              className="flex-1"
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              className="flex-1"
            >
              {isEdit ? "Lưu" : "Thêm"}
            </Button>
          </div>
        </form>
      </Sheet>

      {showScanner && (
        <Suspense fallback={<ScannerFallback />}>
          <BarcodeScanner
            onScan={handleScanned}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}
    </>
  );
}
