import { lazy, Suspense, useState } from "react";
import { Camera, Loader2, Search, Store } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useCart } from "@/stores/cart";
import { useCurrentOrg } from "@/stores/auth";
import { Cart } from "@/components/Cart";
import { ProductSearch } from "@/components/ProductSearch";
import { PaymentSheet } from "@/components/PaymentSheet";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { formatVND } from "@/lib/format";

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

  const total = useCart((s) => s.total)();
  const itemCount = useCart((s) => s.itemCount)();
  const addProduct = useCart((s) => s.addProduct);

  const currentOrg = useCurrentOrg();

  // Số sản phẩm trong DB — hiển thị empty state
  const productCount = useLiveQuery(() => db.products.count(), [], 0);

  const handleScanned = async (barcode: string) => {
    const product = await db.products.where("barcode").equals(barcode).first();
    if (product) {
      addProduct(product);
      setShowScanner(false);
    } else {
      setNotFoundCode(barcode);
      setShowScanner(false);
    }
  };

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

      {/* Mã không tìm thấy */}
      <Sheet
        open={!!notFoundCode}
        onClose={() => setNotFoundCode(null)}
        title="Mã chưa có trong kho"
      >
        <div className="p-5">
          <p className="text-ink-muted mb-3">
            Mã{" "}
            <span className="font-mono font-semibold text-ink">
              {notFoundCode}
            </span>{" "}
            chưa có trong sản phẩm. Bạn có muốn thêm mới?
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setNotFoundCode(null)}
              className="flex-1"
            >
              Bỏ qua
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                // TODO: chuyển sang form thêm sản phẩm với barcode điền sẵn
                setNotFoundCode(null);
              }}
              className="flex-1"
            >
              Thêm sản phẩm
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
