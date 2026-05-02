import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Camera,
  CheckCircle2,
  ChevronUp,
  Loader2,
  Search,
  ShoppingBag,
  Store,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useCart } from "@/stores/cart";
import { useAuthStore, useCurrentOrg } from "@/stores/auth";
import { Cart } from "@/components/Cart";
import { PaymentSheet } from "@/components/PaymentSheet";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import type { ScanFeedback } from "@/components/BarcodeScanner";
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
import { beep, cn, vibrate } from "@/lib/utils";
import type { Product } from "@/types";

// Lazy: BarcodeScanner kéo theo @zxing/browser (~109 KB gzip).
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
  const [showCart, setShowCart] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [notFoundCode, setNotFoundCode] = useState<string | null>(null);
  const [lookupInfo, setLookupInfo] = useState<BarcodeInfo | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [quickAddPrice, setQuickAddPrice] = useState("");
  const [quickAddSubmitting, setQuickAddSubmitting] = useState(false);
  const [manualAddBarcode, setManualAddBarcode] = useState<string | null>(null);

  // Toast feedback cho scanner (continuous mode)
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);

  // FIX: invoke selector inside để Zustand subscribe vào primitive number,
  // không phải function reference (cũ: useCart(s => s.total)() bug desync).
  const items = useCart((s) => s.items);
  const total = useCart((s) => s.total());
  const itemCount = useCart((s) => s.itemCount());
  const addProduct = useCart((s) => s.addProduct);

  const currentOrg = useCurrentOrg();
  const orgId = useAuthStore((s) => s.currentOrgId);

  // Search state
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [flashId, setFlashId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [query]);

  // Live products của org hiện tại
  const products = useLiveQuery(
    async () => {
      if (!orgId) return [];
      const all = await db.products.where({ orgId }).toArray();
      return all.filter((p) => p.isActive);
    },
    [orgId],
    [],
  );

  const filteredProducts = useMemo(() => {
    const list = products ?? [];
    if (!debounced) {
      // Default: show all sorted by updatedAt desc, max 20
      return [...list]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 20);
    }
    return list
      .filter(
        (p) =>
          p.name.toLowerCase().includes(debounced) ||
          p.barcode.includes(debounced),
      )
      .slice(0, 30);
  }, [products, debounced]);

  function handlePickProduct(p: Product) {
    addProduct(p);
    setFlashId(p.id);
    beep(660, 60);
    vibrate(15);
    // Clear flash sau 250ms
    setTimeout(() => setFlashId((curr) => (curr === p.id ? null : curr)), 250);
  }

  // Continuous scan: KHÔNG đóng scanner sau scan. Set toast feedback cho user.
  async function handleScanned(barcode: string) {
    if (!orgId) return;
    const product = await db.products
      .where({ orgId, barcode })
      .first();
    if (product && product.isActive) {
      addProduct(product);
      // Tính số lượng mới của item trong cart sau add (current items có thể stale,
      // dùng store snapshot trực tiếp để chính xác)
      const after = useCart.getState().items.find((it) => it.productId === product.id);
      setScanFeedback({
        type: "success",
        message: `Đã thêm: ${product.name}`,
        sublabel: after ? `× ${after.quantity}` : undefined,
        timestamp: Date.now(),
      });
      return;
    }
    // Not found → toast lỗi + open lookup sheet (giữ scanner open behind)
    setScanFeedback({
      type: "error",
      message: "Mã chưa có trong kho",
      sublabel: "Tap để thêm",
      timestamp: Date.now(),
    });
    // Đóng scanner để user xử lý lookup sheet (khó UX khi cả 2 stack)
    setShowScanner(false);
    setNotFoundCode(barcode);
    setLookupLoading(true);
    try {
      const info = await lookupBarcode(barcode);
      setLookupInfo(info);
    } finally {
      setLookupLoading(false);
    }
  }

  function closeNotFound() {
    setNotFoundCode(null);
    setLookupInfo(null);
    setQuickAddPrice("");
  }

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
        priceCost: 0,
        stock: 0,
        taxRate: 0.08,
        category: lookupInfo.brand || lookupInfo.category,
      });
      outboxWorker.drainNow();
      contributeBarcode({
        barcode: notFoundCode,
        name: lookupInfo.name,
        brand: lookupInfo.brand,
        imageUrl: lookupInfo.imageUrl,
        defaultUnit: lookupInfo.defaultUnit,
      });
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
      {/* Header */}
      <header className="flex items-center justify-between px-4 h-14 bg-bg-card border-b border-line safe-top flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary-700 flex items-center justify-center flex-shrink-0">
            <Store className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">
              {currentOrg?.name ?? "—"}
            </p>
            <p className="text-[11px] text-ink-muted leading-tight">
              {products?.length ?? 0} sản phẩm
            </p>
          </div>
        </div>
      </header>

      {/* Search input */}
      <div className="px-4 py-3 bg-bg-card border-b border-line flex-shrink-0">
        <div className="relative">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tên sản phẩm hoặc mã vạch..."
            className="w-full h-touch pl-11 pr-3 rounded-lg border border-line bg-bg focus:bg-bg-card focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>

      {/* Product list — main area */}
      <div className="flex-1 overflow-y-auto">
        {(products?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-16 h-16 rounded-full bg-bg-subtle flex items-center justify-center mb-3">
              <ShoppingBag className="w-7 h-7 text-ink-subtle" />
            </div>
            <p className="text-ink-muted">Chưa có sản phẩm</p>
            <p className="text-sm text-ink-subtle mt-1">
              Tạo sản phẩm ở tab "Sản phẩm" để bắt đầu bán
            </p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <p className="text-center text-ink-muted py-12 text-sm">
            Không tìm thấy sản phẩm khớp "{query}".
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {filteredProducts.map((p) => {
              const inCart = items.find((it) => it.productId === p.id);
              const flash = flashId === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => handlePickProduct(p)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left press transition-colors",
                      flash
                        ? "bg-primary-50"
                        : "hover:bg-bg-subtle active:bg-bg-subtle",
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink truncate">{p.name}</p>
                      <p className="text-xs text-ink-muted font-mono">
                        {p.barcode || "—"} · {p.unit}
                        {p.stock > 0 && ` · còn ${p.stock}`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0 flex items-center gap-2">
                      {inCart && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-primary-700 text-white text-[11px] font-semibold rounded">
                          ×{inCart.quantity}
                        </span>
                      )}
                      <p className="font-mono font-semibold tabular-nums">
                        {formatVND(p.priceSell)}đ
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Cart summary bar — tap mở CartSheet */}
      <button
        type="button"
        onClick={() => setShowCart(true)}
        className={cn(
          "flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t bg-bg-card press text-left",
          itemCount > 0
            ? "border-primary-100 bg-primary-50/40"
            : "border-line",
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ShoppingBag
            className={cn(
              "w-5 h-5 flex-shrink-0",
              itemCount > 0 ? "text-primary-700" : "text-ink-subtle",
            )}
          />
          <div className="min-w-0">
            {itemCount > 0 ? (
              <>
                <p className="text-sm font-semibold leading-tight">
                  <span className="font-mono tabular-nums">{itemCount}</span> món ·{" "}
                  <span className="font-mono tabular-nums text-primary-700">
                    {formatVND(total)}đ
                  </span>
                </p>
                <p className="text-[11px] text-ink-muted leading-tight">
                  Bấm để xem giỏ hàng
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-muted leading-tight">
                Giỏ hàng trống
              </p>
            )}
          </div>
        </div>
        <ChevronUp
          className={cn(
            "w-4 h-4 flex-shrink-0",
            itemCount > 0 ? "text-primary-700" : "text-ink-subtle",
          )}
        />
      </button>

      {/* Action row — Quét mã + Thanh toán (conditional) */}
      <div
        className={cn(
          "flex-shrink-0 grid gap-2 p-3 bg-bg-card border-t border-line safe-bottom",
          itemCount > 0 ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        <Button
          variant="outline"
          size="lg"
          onClick={() => {
            setScanFeedback(null);
            setShowScanner(true);
          }}
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
            className="w-full"
          >
            Thanh toán {formatVND(total)}đ
          </Button>
        )}
      </div>

      {/* Cart bottom sheet */}
      <Sheet
        open={showCart}
        onClose={() => setShowCart(false)}
        title="Giỏ hàng"
      >
        <div className="flex flex-col max-h-[75vh]">
          <Cart />
          {itemCount > 0 && (
            <div className="border-t border-line bg-bg-card px-4 py-3 safe-bottom">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-ink-muted">Tổng cộng</span>
                <span className="text-money font-mono tabular-nums font-semibold text-primary-700">
                  {formatVND(total)}đ
                </span>
              </div>
              <Button
                variant="accent"
                size="lg"
                onClick={() => {
                  setShowCart(false);
                  setShowPayment(true);
                }}
                className="w-full"
              >
                Thanh toán {formatVND(total)}đ
              </Button>
            </div>
          )}
        </div>
      </Sheet>

      {/* Scanner — continuous mode (KHÔNG auto-close, cooldown 800ms internal) */}
      {showScanner && (
        <Suspense fallback={<ScannerLoadingFallback />}>
          <BarcodeScanner
            onScan={handleScanned}
            onClose={() => {
              setShowScanner(false);
              setScanFeedback(null);
            }}
            feedback={scanFeedback}
            summary={{ count: itemCount, total }}
          />
        </Suspense>
      )}

      {/* Payment sheet */}
      <Sheet
        open={showPayment}
        onClose={() => setShowPayment(false)}
        title="Thanh toán"
      >
        <PaymentSheet onDone={() => setShowPayment(false)} />
      </Sheet>

      {/* Lookup not-found sheet */}
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

      {/* Manual ProductFormModal — prefill barcode */}
      <ProductFormModal
        open={manualAddBarcode !== null}
        onClose={() => setManualAddBarcode(null)}
        product={null}
        initialBarcode={manualAddBarcode ?? undefined}
        onProductAdded={async (p) => {
          addProduct(p);
          vibrate(40);
        }}
      />
    </div>
  );
}
