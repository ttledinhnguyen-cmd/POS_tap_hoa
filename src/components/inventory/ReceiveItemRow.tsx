import { CheckCircle2, Gift, Package, TriangleAlert, X } from "lucide-react";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import { COST_VARIANCE_THRESHOLD } from "@/integrations/sync/inventory-sync";
import type { ReceiveItemInput } from "@/types";

interface Props {
  item: ReceiveItemInput;
  /** Sửa một phần dòng. Dùng cho cả số lượng, giá, quy đổi và hàng tặng. */
  onChange: (patch: Partial<ReceiveItemInput>) => void;
  onRemove: () => void;
  /** True khi vừa thêm — ô số lượng tự focus */
  autoFocus?: boolean;
  /** Chênh lệch giá nhập so với 5 lần trước. Null = chưa đủ lịch sử. */
  costVariance?: { avgRecent: number; lastPrice: number } | null;
}

const QUICK_QTY = [1, 5, 10, 12, 24, 30];
const QUICK_PACK = [1, 2, 5, 10];

/**
 * Một dòng sản phẩm trong phiếu nhập kho.
 *
 * Hai chế độ nhập:
 *   - Theo đơn vị bán: gõ thẳng "48 lon, 10.000đ/lon"
 *   - Theo thùng: gõ "2 thùng, 240.000đ/thùng" → tự ra 48 lon và 10.000đ/lon
 *
 * Chế độ thùng là cách chủ tiệm thực sự mua hàng. Trước đây họ phải tự nhẩm
 * phép chia, mà nhẩm sai thì sai giá vốn và sai âm thầm cho tới lúc xem báo cáo lãi.
 *
 * Số hiển thị ở đây chỉ để chủ tiệm đối chiếu — con số ghi vào kho do SERVER
 * tính lại từ (số thùng × quy cách), không lấy kết quả client tính.
 */
export function ReceiveItemRow({
  item,
  onChange,
  onRemove,
  autoFocus,
  costVariance,
}: Props) {
  const packMode = item.packQty !== undefined;
  const isGift = item.isGift === true;

  // Quy đổi ra đơn vị bán để chủ tiệm thấy ngay mình vừa nhập bao nhiêu
  const packSize = item.packSize && item.packSize > 0 ? item.packSize : 1;
  const effectiveQty = packMode ? (item.packQty ?? 0) * packSize : item.quantity;
  const effectiveUnitPrice = isGift
    ? 0
    : packMode
      ? Math.round((item.packPrice ?? 0) / packSize)
      : item.priceBuy;
  const newTotal = item.currentStock + effectiveQty;
  const lineTotal = Math.round(effectiveUnitPrice * effectiveQty);

  function togglePackMode() {
    if (packMode) {
      // Về chế độ đơn vị bán, giữ lại số đã quy đổi để không mất công gõ lại
      onChange({
        packQty: undefined,
        packPrice: undefined,
        quantity: effectiveQty,
        priceBuy: effectiveUnitPrice,
      });
    } else {
      onChange({
        packQty: 1,
        packSize: item.packSize ?? 24,
        packUnit: item.packUnit ?? "thùng",
        packPrice: Math.round(item.priceBuy * (item.packSize ?? 24)),
      });
    }
  }

  // Cảnh báo giá nhập bất thường — so với giá MỖI ĐƠN VỊ BÁN, không phải giá thùng
  let varianceBadge: { kind: "high" | "low"; message: string } | null = null;
  if (!isGift && costVariance && costVariance.avgRecent > 0 && effectiveUnitPrice > 0) {
    const ratio =
      (effectiveUnitPrice - costVariance.avgRecent) / costVariance.avgRecent;
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
    <div
      className={cn(
        "bg-bg-card border rounded-lg p-3 flex flex-col gap-2.5",
        isGift ? "border-accent/40" : "border-line",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.productName}</p>
          <p className="text-xs text-ink-muted">
            Tồn cũ: <span className="font-mono tabular-nums">{item.currentStock}</span>{" "}
            <span className="text-ink-subtle">→</span>{" "}
            <span className="text-primary-700 font-medium font-mono tabular-nums">
              +{effectiveQty}
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

      {/* Chuyển chế độ nhập + hàng tặng */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={togglePackMode}
          aria-pressed={packMode}
          className={cn(
            "flex items-center gap-1.5 h-9 px-2.5 rounded-md border text-xs font-medium press",
            packMode
              ? "border-primary-500 bg-primary-50 text-primary-700"
              : "border-line text-ink-muted",
          )}
        >
          <Package className="w-3.5 h-3.5" />
          Theo thùng
        </button>
        <button
          type="button"
          onClick={() => onChange({ isGift: !isGift })}
          aria-pressed={isGift}
          className={cn(
            "flex items-center gap-1.5 h-9 px-2.5 rounded-md border text-xs font-medium press",
            isGift
              ? "border-accent bg-accent/10 text-accent"
              : "border-line text-ink-muted",
          )}
        >
          <Gift className="w-3.5 h-3.5" />
          Hàng tặng
        </button>
      </div>

      {packMode ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-muted">
                Số {item.packUnit || "thùng"}
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="1"
                min="0"
                autoFocus={autoFocus}
                value={item.packQty ?? 0}
                onChange={(e) => onChange({ packQty: Number(e.target.value) || 0 })}
                className="h-touch px-3 rounded-lg border border-line bg-bg-card font-mono tabular-nums text-base focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-muted">
                Giá 1 {item.packUnit || "thùng"} (đ)
              </span>
              <input
                type="number"
                inputMode="numeric"
                step="1000"
                min="0"
                disabled={isGift}
                value={isGift ? 0 : (item.packPrice ?? 0)}
                onChange={(e) => onChange({ packPrice: Number(e.target.value) || 0 })}
                className="h-touch px-3 rounded-lg border border-line bg-bg-card font-mono tabular-nums text-base focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="whitespace-nowrap">1 {item.packUnit || "thùng"} =</span>
            <input
              type="number"
              inputMode="decimal"
              step="1"
              min="1"
              value={item.packSize ?? 0}
              onChange={(e) => onChange({ packSize: Number(e.target.value) || 1 })}
              className="w-20 h-9 px-2 rounded-md border border-line bg-bg-card font-mono tabular-nums text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <span>{item.unit}</span>
            {!isGift && effectiveQty > 0 && (
              <span className="ml-auto tabular-nums">
                = {formatVND(effectiveUnitPrice)}đ/{item.unit}
              </span>
            )}
          </label>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_PACK.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ packQty: (item.packQty ?? 0) + n })}
                className="h-9 px-3 rounded-md border border-line bg-bg text-sm font-medium text-ink-muted press hover:border-primary-500 hover:text-primary-700 min-w-[44px]"
              >
                +{n}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
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
                onChange={(e) => onChange({ quantity: Number(e.target.value) || 0 })}
                className="h-touch px-3 rounded-lg border border-line bg-bg-card font-mono tabular-nums text-base focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-ink-muted">Giá nhập (đ)</span>
              <input
                type="number"
                inputMode="numeric"
                step="500"
                min="0"
                disabled={isGift}
                value={isGift ? 0 : item.priceBuy}
                onChange={(e) => onChange({ priceBuy: Number(e.target.value) || 0 })}
                className="h-touch px-3 rounded-lg border border-line bg-bg-card font-mono tabular-nums text-base focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_QTY.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ quantity: item.quantity + n })}
                aria-label={`Thêm ${n}`}
                className="h-9 px-3 rounded-md border border-line bg-bg text-sm font-medium text-ink-muted press hover:border-primary-500 hover:text-primary-700 min-w-[44px]"
              >
                +{n}
              </button>
            ))}
          </div>
        </>
      )}

      {isGift && (
        <p className="flex items-start gap-1.5 rounded-md bg-accent/10 px-2 py-1.5 text-[11px] leading-tight text-accent">
          <Gift className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>Cộng vào kho nhưng không tính tiền và không đổi giá vốn.</span>
        </p>
      )}

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

      <div className="flex justify-end items-baseline gap-1 pt-1 border-t border-line/50">
        <span className="text-[11px] text-ink-muted">Thành tiền:</span>
        <span className="font-mono tabular-nums font-semibold text-primary-700">
          {formatVND(lineTotal)}đ
        </span>
      </div>
    </div>
  );
}
