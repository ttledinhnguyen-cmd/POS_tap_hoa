import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  open: boolean;
  barcode: string;
  onAdd: () => void;
  onSkip: () => void;
}

/**
 * Modal nhỏ hiện khi quét barcode chưa có trong kho.
 * 2 lựa chọn: "Thêm sản phẩm" → mở ProductFormModal prefill barcode, hoặc
 * "Bỏ qua" → đóng dialog, user quay về form nhập kho.
 */
export function AddProductPrompt({ open, barcode, onAdd, onSkip }: Props) {
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
          <div className="flex-1">
            <h3 className="font-semibold text-base">Sản phẩm mới?</h3>
            <p className="text-sm text-ink-muted mt-1">
              Mã vạch{" "}
              <span className="font-mono text-ink">{barcode}</span> chưa có
              trong kho.
            </p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Đóng"
            className="p-1 -m-1 rounded text-ink-muted hover:text-ink press"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onSkip}
            className="flex-1"
          >
            Bỏ qua
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onAdd}
            className="flex-1"
          >
            Thêm sản phẩm
          </Button>
        </div>
      </div>
    </div>
  );
}
