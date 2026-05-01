import { X } from "lucide-react";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ReceiveItemInput } from "@/types";

interface Props {
  item: ReceiveItemInput;
  onChangeQuantity: (qty: number) => void;
  onChangePriceBuy: (price: number) => void;
  onRemove: () => void;
  /** True khi vừa thêm — quantity input auto-focus */
  autoFocus?: boolean;
}

const QUICK_QTY = [1, 5, 10, 12, 24, 30];

/**
 * 1 dòng sản phẩm trong form Nhập kho.
 *
 * Quick qty buttons: ADD-style — tap +5 cộng 5 vào qty hiện tại (Q chốt Phase 2A).
 * "Tồn cũ X → +Y = Z" hiển thị real-time delta để chủ shop xác nhận.
 */
export function ReceiveItemRow({
  item,
  onChangeQuantity,
  onChangePriceBuy,
  onRemove,
  autoFocus,
}: Props) {
  const newTotal = item.currentStock + item.quantity;
  const lineTotal = Math.round(item.priceBuy * item.quantity);

  return (
    <div className="bg-bg-card border border-line rounded-lg p-3 flex flex-col gap-2.5">
      {/* Header: tên + nút xóa */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.productName}</p>
          <p className="text-xs text-ink-muted">
            Tồn cũ: <span className="font-mono tabular-nums">{item.currentStock}</span>{" "}
            <span className="text-ink-subtle">→</span>{" "}
            <span className="text-primary-700 font-medium font-mono tabular-nums">
              +{item.quantity}
            </span>{" "}
            <span className="text-ink-subtle">=</span>{" "}
            <span className="font-mono tabular-nums font-semibold">{newTotal}</span>{" "}
            {item.unit}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Xóa khỏi danh sách"
          className="p-1.5 rounded text-ink-muted hover:bg-danger-bg hover:text-danger press flex-shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Row: qty input + price input */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-muted">Số lượng</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            autoFocus={autoFocus}
            value={item.quantity}
            onChange={(e) => onChangeQuantity(Number(e.target.value) || 0)}
            className="h-touch px-3 rounded-lg border border-line bg-bg-card font-mono tabular-nums text-base focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-muted">Giá nhập (đ)</span>
          <input
            type="number"
            inputMode="numeric"
            step="500"
            min="0"
            value={item.priceBuy}
            onChange={(e) => onChangePriceBuy(Number(e.target.value) || 0)}
            className="h-touch px-3 rounded-lg border border-line bg-bg-card font-mono tabular-nums text-base focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </label>
      </div>

      {/* Quick qty buttons — ADD style */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_QTY.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChangeQuantity(item.quantity + n)}
            aria-label={`Thêm ${n}`}
            className={cn(
              "h-9 px-3 rounded-md border border-line bg-bg",
              "text-sm font-medium text-ink-muted press",
              "hover:border-primary-500 hover:text-primary-700",
              "min-w-[44px]",
            )}
          >
            +{n}
          </button>
        ))}
      </div>

      {/* Line total */}
      <div className="flex justify-end items-baseline gap-1 pt-1 border-t border-line/50">
        <span className="text-[11px] text-ink-muted">Thành tiền:</span>
        <span className="font-mono tabular-nums font-semibold text-primary-700">
          {formatVND(lineTotal)}đ
        </span>
      </div>
    </div>
  );
}
