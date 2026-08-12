import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Loader2, Package, Search } from "lucide-react";
import { db } from "@/lib/db";
import { useAuthStore, useCurrentRole } from "@/stores/auth";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { FormField } from "@/components/ui/FormField";
import { ReceiveItemRow } from "@/components/inventory/ReceiveItemRow";
import { AddProductPrompt } from "@/components/inventory/AddProductPrompt";
import { ProductPicker } from "@/components/inventory/ProductPicker";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import { api } from "@/integrations/api";
import { inventorySync } from "@/integrations/sync/inventory-sync";
import { outboxWorker } from "@/integrations/sync/outbox-worker";
import { formatVND } from "@/lib/format";
import { beep, vibrate } from "@/lib/utils";
import type { Product, ReceiveItemInput } from "@/types";

// Lazy: BarcodeScanner kéo @zxing/browser ~109 KB gzip — chỉ tải khi click "Quét"
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

/** YYYY-MM-DD ở local timezone (date input format). */
function todayDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function InventoryReceivePage() {
  const navigate = useNavigate();
  const orgId = useAuthStore((s) => s.currentOrgId);
  const role = useCurrentRole();

  // Form info NCC
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierTaxCode, setSupplierTaxCode] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayDateString());
  const [invoiceNo, setInvoiceNo] = useState("");
  const [notes, setNotes] = useState("");

  // Items list
  const [items, setItems] = useState<ReceiveItemInput[]>([]);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  // Cost variance cache: productId → result. Tải 1 lần khi product được add.
  const [variances, setVariances] = useState<
    Map<string, { avgRecent: number; lastPrice: number } | null>
  >(new Map());

  // Load cost variance khi item mới thêm vào list (chưa có cache)
  useEffect(() => {
    items.forEach((it) => {
      if (variances.has(it.productId)) return;
      inventorySync
        .getCostVariance(it.productId)
        .then((cv) => {
          setVariances((prev) => {
            if (prev.has(it.productId)) return prev;
            const next = new Map(prev);
            next.set(it.productId, cv);
            return next;
          });
        })
        .catch(() => {
          /* ignore — variance là nice-to-have */
        });
    });
  }, [items, variances]);

  // Modals
  const [showScanner, setShowScanner] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingNewBarcode, setPendingNewBarcode] = useState<string | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Cashier không được vào — redirect /products
  if (role && role !== "owner") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center gap-3">
        <Package className="w-12 h-12 text-ink-subtle" />
        <p className="text-base font-medium">Bạn không có quyền truy cập tính năng này</p>
        <p className="text-sm text-ink-muted">Chỉ chủ tiệm mới có thể nhập kho.</p>
        <Button variant="primary" onClick={() => navigate("/products")}>
          Quay về Sản phẩm
        </Button>
      </div>
    );
  }

  // ----- Add helpers -----
  function addProductToList(product: Product) {
    setItems((curr) => {
      // Đã có trong list → tăng qty +=1
      const idx = curr.findIndex((it) => it.productId === product.id);
      if (idx >= 0) {
        const next = curr.slice();
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        beep(660, 60);
        vibrate(20);
        return next;
      }
      // Chưa có → add row mới với qty=1, priceBuy = product.priceCost hiện tại
      const newItem: ReceiveItemInput = {
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        quantity: 1,
        priceBuy: product.priceCost,
        currentStock: product.stock,
        // Nhớ quy cách đóng gói của lần nhập trước để khỏi gõ lại
        packSize: product.packSize,
        packUnit: product.packUnit,
      };
      beep(880, 80);
      vibrate(40);
      setLastAddedId(product.id);
      return [...curr, newItem];
    });
  }

  // ----- Scanner -----
  async function handleScanned(barcode: string) {
    setShowScanner(false);
    if (!orgId) return;
    const found = await db.products
      .where({ orgId, barcode })
      .first();
    if (found && found.isActive) {
      addProductToList(found);
    } else {
      // Mã chưa có → mở prompt thêm sản phẩm
      setPendingNewBarcode(barcode);
    }
  }

  function handlePromptAdd() {
    setShowProductForm(true);
  }

  function handlePromptSkip() {
    setPendingNewBarcode(null);
  }

  function handleProductFormClose() {
    setShowProductForm(false);
    // Khi đóng form mà không add (cancel), pendingNewBarcode đã clear khi save
    setPendingNewBarcode(null);
  }

  function handleProductAdded(p: Product) {
    setPendingNewBarcode(null);
    addProductToList(p);
  }

  // ----- Item updates -----
  function updateItem(productId: string, patch: Partial<ReceiveItemInput>) {
    setItems((curr) =>
      curr.map((it) => (it.productId === productId ? { ...it, ...patch } : it)),
    );
  }
  function removeItem(productId: string) {
    setItems((curr) => curr.filter((it) => it.productId !== productId));
  }

  // ----- Total -----
  const totalCost = useMemo(
    () =>
      items.reduce((sum, it) => {
        if (it.isGift) return sum; // hàng tặng không tính tiền
        if (it.packQty !== undefined) {
          return sum + Math.round((it.packPrice ?? 0) * it.packQty);
        }
        return sum + Math.round(it.priceBuy * it.quantity);
      }, 0),
    [items],
  );
  const itemCount = items.length;

  // ----- Submit -----
  async function handleConfirm() {
    if (!orgId) return;
    if (items.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Filter out items với qty <= 0 hoặc price < 0
      const validItems = items.filter((it) =>
        it.packQty !== undefined ? it.packQty > 0 : it.quantity > 0,
      );
      if (validItems.length === 0) {
        setSubmitError("Không có dòng hợp lệ (số lượng phải > 0)");
        setSubmitting(false);
        return;
      }
      // Ghi tên NCC vào danh mục để theo dõi công nợ. Server khớp bỏ dấu +
      // bỏ hoa thường nên gõ "npp masan" hôm nay và "NPP Masan" hôm sau vẫn ra
      // cùng một nhà cung cấp, không tách công nợ làm đôi.
      //
      // Lỗi ở bước này KHÔNG được chặn việc nhập kho: mất mạng thì phiếu vẫn
      // phải lưu được vào Dexie rồi đồng bộ sau, đó là cả điểm của offline-first.
      let supplierId: string | undefined;
      if (supplierName.trim()) {
        try {
          supplierId = await api.rpc<string>("upsert_supplier", {
            p_org_id: orgId,
            p_name: supplierName.trim(),
            p_id: null,
            p_phone: supplierPhone.trim() || null,
            p_tax_code: supplierTaxCode.trim() || null,
            p_address: null,
            p_notes: null,
          });
        } catch {
          // Bỏ qua — phiếu vẫn lưu, chỉ là chưa gắn được vào công nợ
        }
      }

      await inventorySync.createReceipt(
        orgId,
        {
          supplierId,
          supplierName: supplierName.trim() || undefined,
          supplierPhone: supplierPhone.trim() || undefined,
          supplierTaxCode: supplierTaxCode.trim() || undefined,
          receiptDate,
          invoiceNo: invoiceNo.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        validItems,
      );
      outboxWorker.drainNow();
      vibrate([60, 40, 60]);
      // Q3 chốt: redirect /products?received=1 để user thấy stock update
      navigate("/products?received=1", { replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Nhập kho thất bại");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg">
        <div>
          <h1 className="text-lg md:text-xl font-semibold">Nhập kho mới</h1>
          <p className="text-xs text-ink-muted">
            {itemCount === 0 ? "Chưa có sản phẩm" : `${itemCount} mặt hàng`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            Hủy
          </Button>
        </div>
      </div>

      {/* Body scrollable */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 pb-32 md:pb-24 space-y-5">
        {/* Form info NCC */}
        <details className="bg-bg-card border border-line rounded-lg" open={items.length === 0}>
          <summary className="px-4 py-3 cursor-pointer select-none text-sm font-medium flex items-center justify-between">
            <span>Thông tin nhà cung cấp</span>
            <span className="text-xs text-ink-muted font-normal">
              {supplierName || "—"}
            </span>
          </summary>
          <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="Tên NCC" optional>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="Công ty TNHH ABC"
              />
            </FormField>
            <FormField label="SĐT NCC" optional>
              <input
                type="tel"
                inputMode="tel"
                value={supplierPhone}
                onChange={(e) => setSupplierPhone(e.target.value)}
                placeholder="0901234567"
              />
            </FormField>
            <FormField label="MST NCC" optional>
              <input
                type="text"
                inputMode="numeric"
                value={supplierTaxCode}
                onChange={(e) => setSupplierTaxCode(e.target.value)}
                placeholder="0123456789"
              />
            </FormField>
            <FormField label="Ngày nhập">
              <input
                type="date"
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
              />
            </FormField>
            <FormField label="Số HĐ NCC" optional>
              <input
                type="text"
                value={invoiceNo}
                onChange={(e) => setInvoiceNo(e.target.value)}
                placeholder="HD-2026-0001"
              />
            </FormField>
            <FormField label="Ghi chú" optional>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Hàng giảm giá, hàng cận date..."
              />
            </FormField>
          </div>
        </details>

        {/* Section sản phẩm */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Sản phẩm nhập</h2>
            {items.length > 0 && (
              <p className="text-xs text-ink-muted">{itemCount} dòng</p>
            )}
          </div>

          {items.length === 0 ? (
            <div className="text-center py-12 px-4 border border-dashed border-line rounded-lg bg-bg">
              <Package className="w-10 h-10 text-ink-subtle mx-auto mb-2" />
              <p className="text-sm text-ink-muted">
                Chưa có sản phẩm. Quét mã hoặc tìm để thêm.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((it) => (
                <ReceiveItemRow
                  key={it.productId}
                  item={it}
                  onChange={(patch) => updateItem(it.productId, patch)}
                  onRemove={() => removeItem(it.productId)}
                  autoFocus={lastAddedId === it.productId}
                  costVariance={variances.get(it.productId) ?? null}
                />
              ))}
            </div>
          )}

          {/* 2 buttons add */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => setShowScanner(true)}
              className="w-full"
            >
              <Camera className="w-5 h-5" />
              Quét mã
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowPicker(true)}
              className="w-full"
            >
              <Search className="w-5 h-5" />
              Tìm sản phẩm
            </Button>
          </div>
        </div>
      </div>

      {/* Footer sticky */}
      <div className="fixed bottom-16 md:bottom-0 left-0 right-0 md:left-60 border-t border-line bg-bg-card px-4 md:px-6 py-3 z-20">
        <div className="flex items-center justify-between gap-3 max-w-5xl mx-auto">
          <div>
            <p className="text-xs text-ink-muted">Tổng tiền nhập</p>
            <p className="text-lg font-semibold font-mono tabular-nums text-primary-700">
              {formatVND(totalCost)}đ
            </p>
          </div>
          <Button
            type="button"
            variant="primary"
            disabled={items.length === 0 || submitting}
            loading={submitting}
            onClick={() => setConfirmOpen(true)}
            className="px-6"
          >
            Xác nhận nhập kho
          </Button>
        </div>
        {submitError && (
          <p className="text-xs text-danger mt-1 text-right" role="alert">
            {submitError}
          </p>
        )}
      </div>

      {/* Confirm sheet */}
      <Sheet
        open={confirmOpen}
        onClose={() => !submitting && setConfirmOpen(false)}
        title="Xác nhận nhập kho"
      >
        <div className="px-5 pb-5 flex flex-col gap-4">
          <div className="bg-bg rounded-lg p-3 text-sm space-y-1">
            <p>
              Sẽ nhập <span className="font-semibold">{itemCount} sản phẩm</span> vào kho
            </p>
            <p>
              Tổng tiền:{" "}
              <span className="font-mono tabular-nums font-semibold text-primary-700">
                {formatVND(totalCost)}đ
              </span>
            </p>
            {supplierName && (
              <p className="text-ink-muted">NCC: {supplierName}</p>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            Tồn kho và giá vốn của các sản phẩm sẽ được cập nhật theo phiếu này.
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
              className="flex-1"
            >
              Quay lại
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirm}
              loading={submitting}
              className="flex-1"
            >
              {submitting ? "Đang nhập..." : "Xác nhận"}
            </Button>
          </div>
        </div>
      </Sheet>

      {/* Picker sheet */}
      <Sheet
        open={showPicker}
        onClose={() => setShowPicker(false)}
        title="Tìm sản phẩm"
      >
        <div className="h-[70vh] md:h-[60vh]">
          <ProductPicker
            onPick={(p) => addProductToList(p)}
            onClose={() => setShowPicker(false)}
          />
        </div>
      </Sheet>

      {/* Scanner full-screen */}
      {showScanner && (
        <Suspense fallback={<ScannerFallback />}>
          <BarcodeScanner
            onScan={handleScanned}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}

      {/* Add prompt khi quét EAN chưa có */}
      <AddProductPrompt
        open={pendingNewBarcode !== null && !showProductForm}
        barcode={pendingNewBarcode ?? ""}
        onAdd={handlePromptAdd}
        onSkip={handlePromptSkip}
      />

      {/* ProductFormModal — prefill barcode + callback addProductToList */}
      <ProductFormModal
        open={showProductForm}
        onClose={handleProductFormClose}
        product={null}
        initialBarcode={pendingNewBarcode ?? ""}
        onProductAdded={handleProductAdded}
      />
    </div>
  );
}
