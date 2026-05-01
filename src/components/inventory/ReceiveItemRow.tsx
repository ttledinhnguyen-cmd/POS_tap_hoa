import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COST_VARIANCE_THRESHOLD } from "@/integrations/sync/inventory-sync";
import type { ReceiveItemInput } from "@/types";

interface Props {
  item: ReceiveItemInput;
  onChangeQuantity: (qty: number) => void;
  onChangePriceBuy: (price: number) => void;
  onRemove: () => void;
  /** True khi vừa thêm — quantity input auto-focus */
  autoFocus?: boolean;
  /**
   * Cost variance từ getCostVariance(productId). Null = chưa đủ history.
   * Component tự so sánh với priceBuy hiện tại để hiển thị badge.
   */
  costVariance?: { avgRecent: number; lastPrice: number } | null;
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
  costVariance,
}: Props) {
  const newTotal = item.currentStock + item.quantity;
  const lineTotal = Math.round(item.priceBuy * item.quantity);

  // Cost variance: so sánh giá user đang nhập với trung bình 5 lần trước
  // (badge update real-time khi user gõ priceBuy)
  let varianceBadge: { kind: "high" | "low"; message: string } | null = null;
  if (costVariance && costVariance.avgRecent > 0 && item.priceBuy > 0) {
    const ratio = (item.priceBuy - costVariance.avgRecent) / costVariance.avgRecent;
    if (ratio > COST_VARIANCE_THRESHOLD) {
      varianceBadge = {
        kind: "high",
        message: `Giá nhập cao hơn ${Math.round(ratio * 100)}% so với 5 lần trước (TB: ${formatVND(costVariance.avgRecent)}đ)`,
      };
    } else if (ratio < -COST_VARIANCE_THRESHOLD) {
      varianceBadge = {
        kind: "low",
        message: `Giá nhập thấp hơn ${Math.round(Math.abs(ratio) * 100)}% so với 5 lần trước (TB: ${formatVND(costVariance.avgRecent)}đ)`,
      };
    }
  }

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

      {/* Cost variance badge */}
      {varianceBadge && (
        <div
          className={cn(
            "flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-tight",
            varianceBadge.kind === "high"
              ? "bg-danger-bg text-danger"
              : "bg-primary-50 text-primary-800",
          )}
          role="status"
        >
          {varianceBadge.kind === "high" ? (
            <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          )}
          <span>{varianceBadge.message}</span>
        </div>
      )}

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
