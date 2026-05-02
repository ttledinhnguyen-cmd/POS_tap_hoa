import { lazy, Suspense, useState } from "react";
import { Camera, CheckCircle2, Loader2, Search, Store } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useCart } from "@/stores/cart";
import { useAuthStore, useCurrentOrg } from "@/stores/auth";
import { Cart } from "@/components/Cart";
import { ProductSearch } from "@/components/ProductSearch";
import { PaymentSheet } from "@/components/PaymentSheet";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import {
  contributeBarcode,
  lookupBarcode,
  type BarcodeInfo,
} from "@/integrations/barcode/lookup";
import { productsSync } from "@/integrations/sync/products-sync";
import { outboxWorker } from "@/integrations/sync/outbox-worker";
import { formatVND } from "@/lib/format";
import { vibrate } from "@/lib/utils";

// Lazy: BarcodeScanner kéo theo @zxing/browser (~80-100 KB).
// Chỉ load chunk khi user click "Quét mã" — tiết kiệm initial bundle.
const BarcodeScanner = lazy(() =>
  import("@/components/BarcodeScanner").then((m) => ({
    default: m.BarcodeScanner,
  })),
);

function ScannerLoadingFallback() {
  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center text-white">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">Đang mở camera...</p>
      </div>
    </div>
  );
}

export function POSPage() {
  const [showScanner, setShowScanner] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  // Lookup result + price input cho "Thêm vào sản phẩm và bán" flow
  const [lookupInfo, setLookupInfo] = useState<BarcodeInfo | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [quickAddPrice, setQuickAddPrice] = useState("");
  const [quickAddSubmitting, setQuickAddSubmitting] = useState(false);
  // Manual fallback: mở ProductFormModal full với barcode prefill
  const [manualAddBarcode, setManualAddBarcode] = useState<string | null>(null);

  const total = useCart((s) => s.total)();
  const itemCount = useCart((s) => s.itemCount)();
  const addProduct = useCart((s) => s.addProduct);

  const currentOrg = useCurrentOrg();
  const orgId = useAuthStore((s) => s.currentOrgId);

  // Số sản phẩm trong DB — hiển thị empty state
  const productCount = useLiveQuery(() => db.products.count(), [], 0);

  const handleScanned = async (barcode: string) => {
    setShowScanner(false);
    const product = await db.products.where("barcode").equals(barcode).first();
    if (product) {
      addProduct(product);
      return;
    }
    // Chưa có trong Dexie → lookup community + OFF
    setNotFoundCode(barcode);
    setLookupLoading(true);
    try {
      const info = await lookupBarcode(barcode);
      setLookupInfo(info);
    } finally {
      setLookupLoading(false);
    }
  };

  function closeNotFound() {
    setNotFoundCode(null);
    setLookupInfo(null);
    setQuickAddPrice("");
  }

  /** Quick-add: tạo product từ lookup + price → upsert + add to cart 1 lần. */
  async function handleQuickAdd() {
    if (!notFoundCode || !lookupInfo || !orgId) return;
    const price = Number(quickAddPrice);
    if (!quickAddPrice || Number.isNaN(price) || price < 0) return;
    setQuickAddSubmitting(true);
    try {
      const id = await productsSync.upsertProduct(orgId, {
        barcode: notFoundCode,
        name: lookupInfo.name,
        unit: lookupInfo.defaultUnit || "cái",
        priceSell: price,
        priceCost: 0, // owner có thể edit sau
        stock: 0,
        taxRate: 0.08,
        category: lookupInfo.brand || lookupInfo.category,
      });
      outboxWorker.drainNow();
      // Contribute barcode community (fire-and-forget)
      contributeBarcode({
        barcode: notFoundCode,
        name: lookupInfo.name,
        brand: lookupInfo.brand,
        imageUrl: lookupInfo.imageUrl,
        defaultUnit: lookupInfo.defaultUnit,
      });
      // Add to cart
      const fresh = await db.products.get(id);
      if (fresh) {
        addProduct(fresh);
        vibrate(40);
      }
      closeNotFound();
    } finally {
      setQuickAddSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Header — gọn, không chiếm chỗ */}
      <header className="flex items-center justify-between px-4 h-14 bg-bg-card border-b border-line safe-top">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary-700 flex items-center justify-center">
            <Store className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">
              {currentOrg?.name ?? "—"}
            </p>
            <p className="text-[11px] text-ink-muted leading-tight">
              {productCount ?? 0} sản phẩm
            </p>
          </div>
        </div>
      </header>

      {/* Cart — chiếm phần lớn màn hình */}
      <Cart />

      {/* Tổng tiền — hiển thị to, dễ thấy */}
      <div className="px-5 py-3 bg-bg-card border-t border-line">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-ink-muted uppercase tracking-wide">
              Tổng cộng
            </p>
            <p className="text-money-lg font-mono tabular-nums text-primary-700">
              {formatVND(total)}đ
            </p>
          </div>
          {itemCount > 0 && (
            <p className="text-sm text-ink-muted pb-1">
              {itemCount} món
            </p>
          )}
        </div>
      </div>

      {/* Thanh hành động — TRONG VÙNG NGÓN CÁI */}
      <div className="grid grid-cols-2 gap-2 p-3 bg-bg-card border-t border-line safe-bottom">
        <Button
          variant="outline"
          size="lg"
          onClick={() => setShowSearch(true)}
          className="w-full"
        >
          <Search className="w-5 h-5" />
          Tìm
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => setShowScanner(true)}
          className="w-full"
        >
          <Camera className="w-5 h-5" />
          Quét mã
        </Button>
        {itemCount > 0 && (
          <Button
            variant="accent"
            size="lg"
            onClick={() => setShowPayment(true)}
            className="col-span-2 w-full"
          >
            Thanh toán {formatVND(total)}đ
          </Button>
        )}
      </div>

      {/* Scanner full-screen — lazy load chunk @zxing khi user click "Quét mã" */}
      {showScanner && (
        <Suspense fallback={<ScannerLoadingFallback />}>
          <BarcodeScanner
            onScan={handleScanned}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}

      {/* Search bottom sheet */}
      <Sheet
        open={showSearch}
        onClose={() => setShowSearch(false)}
        title="Tìm sản phẩm"
      >
        <ProductSearch onClose={() => setShowSearch(false)} />
      </Sheet>

      {/* Payment bottom sheet */}
      <Sheet
        open={showPayment}
        onClose={() => setShowPayment(false)}
        title="Thanh toán"
      >
        <PaymentSheet onDone={() => setShowPayment(false)} />
      </Sheet>

      {/* Mã không tìm thấy — 3 states: loading lookup / found community/OFF / not found */}
      <Sheet
        open={!!notFoundCode}
        onClose={closeNotFound}
        title={
          lookupLoading
            ? "Đang tìm trong kho cộng đồng..."
            : lookupInfo
              ? "Tìm thấy thông tin sản phẩm"
              : "Mã chưa có trong kho"
        }
      >
        <div className="p-5 space-y-4">
          <p className="text-xs text-ink-muted">
            Mã:{" "}
            <span className="font-mono font-semibold text-ink">
              {notFoundCode}
            </span>
          </p>

          {lookupLoading && (
            <div className="flex items-center gap-2 text-sm text-ink-muted py-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              Đang tra cứu...
            </div>
          )}

          {!lookupLoading && lookupInfo && (
            <>
              {/* Found banner */}
              <div className="flex items-start gap-3 rounded-lg p-3 bg-primary-50 border border-primary-100">
                {lookupInfo.imageUrl && (
                  <img
                    src={lookupInfo.imageUrl}
                    alt=""
                    className="w-14 h-14 rounded object-cover flex-shrink-0 bg-bg-card"
                    loading="lazy"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-primary-800">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                    <span className="text-xs font-medium">
                      {lookupInfo.source === "shared"
                        ? "Từ kho cộng đồng"
                        : "Từ Open Food Facts"}
                    </span>
                  </div>
                  <p className="text-sm font-semibold mt-0.5">
                    {lookupInfo.name}
                  </p>
                  {lookupInfo.brand && (
                    <p className="text-xs text-ink-muted">
                      {lookupInfo.brand}
                    </p>
                  )}
                </div>
              </div>

              <FormField label="Giá bán (đồng)" hint="Bắt buộc — giá để bán sản phẩm này">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="500"
                  autoFocus
                  value={quickAddPrice}
                  onChange={(e) => setQuickAddPrice(e.target.value)}
                  placeholder="0"
                />
              </FormField>

              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setManualAddBarcode(notFoundCode);
                    closeNotFound();
                  }}
                  disabled={quickAddSubmitting}
                  className="flex-1"
                >
                  Sửa thêm
                </Button>
                <Button
                  variant="primary"
                  onClick={handleQuickAdd}
                  loading={quickAddSubmitting}
                  disabled={!quickAddPrice || Number(quickAddPrice) < 0}
                  className="flex-1"
                >
                  Thêm + Bán
                </Button>
              </div>
            </>
          )}

          {!lookupLoading && !lookupInfo && (
            <>
              <p className="text-sm text-ink-muted">
                Mã này chưa có trong kho cộng đồng. Tự nhập tên + giá để
                thêm vào shop của bạn.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={closeNotFound}
                  className="flex-1"
                >
                  Bỏ qua
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setManualAddBarcode(notFoundCode);
                    closeNotFound();
                  }}
                  className="flex-1"
                >
                  Thêm thủ công
                </Button>
              </div>
            </>
          )}
        </div>
      </Sheet>

      {/* Manual ProductFormModal — prefill barcode khi user click "Sửa thêm" / "Thêm thủ công" */}
      <ProductFormModal
        open={manualAddBarcode !== null}
        onClose={() => setManualAddBarcode(null)}
        product={null}
        initialBarcode={manualAddBarcode ?? undefined}
        onProductAdded={async (p) => {
          // Sau khi tạo, thêm vào cart luôn
          addProduct(p);
          vibrate(40);
        }}
      />
    </div>
  );
}
