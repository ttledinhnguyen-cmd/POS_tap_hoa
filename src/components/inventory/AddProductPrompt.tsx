import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { lookupBarcode, type BarcodeInfo } from "@/integrations/barcode/lookup";

interface Props {
  open: boolean;
  barcode: string;
  onAdd: () => void;
  onSkip: () => void;
}

/**
 * Modal nhỏ hiện khi quét barcode chưa có trong kho.
 *
 * Khi mở, tự động lookup barcode trong shared_barcodes + Open Food Facts.
 * Nếu found → hiển thị tên/brand/image preview + nút "Thêm vào kho" (vẫn mở
 * ProductFormModal với prefill — modal đó cũng sẽ lookup lại + prefill).
 * Nếu không found → fallback message "Mã chưa có. Thêm thủ công?".
 */
export function AddProductPrompt({ open, barcode, onAdd, onSkip }: Props) {
  const [info, setInfo] = useState<BarcodeInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !barcode) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setInfo(null);
    lookupBarcode(barcode)
      .then((result) => {
        if (!cancelled) setInfo(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, barcode]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-bg-card rounded-xl shadow-xl max-w-sm w-full p-5 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary-50 flex items-center justify-center flex-shrink-0">
            <Plus className="w-5 h-5 text-primary-700" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base">
              {info ? "Sản phẩm tìm thấy" : "Sản phẩm mới?"}
            </h3>
            <p className="text-sm text-ink-muted mt-1">
              Mã vạch{" "}
              <span className="font-mono text-ink">{barcode}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Đóng"
            className="p-1 -m-1 rounded text-ink-muted hover:text-ink press flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="w-4 h-4 animate-spin" />
            Đang tra cứu...
          </div>
        )}

        {!loading && info && (
          <div className="flex items-start gap-3 rounded-lg p-3 bg-primary-50 border border-primary-100">
            {info.imageUrl && (
              <img
                src={info.imageUrl}
                alt=""
                className="w-12 h-12 rounded object-cover flex-shrink-0 bg-bg-card"
                loading="lazy"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-primary-800">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-[11px] font-medium">
                  {info.source === "shared"
                    ? "Từ kho cộng đồng"
                    : "Từ Open Food Facts"}
                </span>
              </div>
              <p className="text-sm font-semibold mt-0.5 truncate">
                {info.name}
              </p>
              {info.brand && (
                <p className="text-xs text-ink-muted truncate">
                  {info.brand}
                </p>
              )}
            </div>
          </div>
        )}

        {!loading && !info && (
          <p className="text-sm text-ink-muted">
            Chưa có trong kho cộng đồng. Bạn có thể nhập tay tên + giá để thêm
            vào kho của tiệm.
          </p>
        )}

        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onSkip} className="flex-1">
            Bỏ qua
          </Button>
          <Button type="button" variant="primary" onClick={onAdd} className="flex-1">
            {info ? "Thêm vào kho" : "Thêm thủ công"}
          </Button>
        </div>
      </div>
    </div>
  );
}
