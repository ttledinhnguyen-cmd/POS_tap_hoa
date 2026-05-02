import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { db } from "@/lib/db";
import { useAuthStore, useCurrentRole } from "@/stores/auth";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { ProductPicker } from "@/components/inventory/ProductPicker";
import { stockTakeSync } from "@/integrations/sync/stock-take-sync";
import { formatVND } from "@/lib/format";
import { beep, cn, vibrate } from "@/lib/utils";
import type { Product, StockTakeReason } from "@/types";

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

const REASON_LABEL: Record<StockTakeReason, string> = {
  shrinkage: "Hao hụt",
  damaged: "Hỏng",
  expired: "Hết hạn",
  found: "Tìm thấy thêm",
  count_error: "Sai sót đếm trước",
  other: "Khác",
};

const STATUS_LABEL: Record<
  "in_progress" | "committed" | "cancelled",
  { label: string; cls: string }
> = {
  in_progress: { label: "Đang đếm", cls: "bg-accent/10 text-accent" },
  committed: { label: "Đã hoàn tất", cls: "bg-primary-50 text-primary-700" },
  cancelled: { label: "Đã hủy", cls: "bg-bg-subtle text-ink-muted" },
};

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export function StockTakeDetailPage() {
  const { id: takeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const role = useCurrentRole();
  const orgId = useAuthStore((s) => s.currentOrgId);

  const [showScanner, setShowScanner] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live: take header + items từ Dexie
  const take = useLiveQuery(
    async () => (takeId ? db.stockTakes.get(takeId) : undefined),
    [takeId],
    undefined,
  );
  const items = useLiveQuery(
    async () => {
      if (!takeId) return [];
      return db.stockTakeItems
        .where("stockTakeId")
        .equals(takeId)
        .toArray();
    },
    [takeId],
    [],
  );

  // Pull lần đầu khi mở (force fresh)
  useEffect(() => {
    if (!takeId) return;
    stockTakeSync.pullStockTakeHeader(takeId).catch(() => undefined);
    stockTakeSync.pullStockTakeItems(takeId).catch(() => undefined);
  }, [takeId]);

  // Cashier vào URL trực tiếp → block
  if (role && role !== "owner") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center gap-3">
        <ClipboardCheck className="w-12 h-12 text-ink-subtle" />
        <p className="text-base font-medium">Chỉ chủ shop được kiểm kê</p>
        <Button variant="primary" onClick={() => navigate("/inventory")}>
          Quay về Kho hàng
        </Button>
      </div>
    );
  }

  if (!take) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-primary-700" />
      </div>
    );
  }

  const isInProgress = take.status === "in_progress";
  const badge = STATUS_LABEL[take.status];

  async function handleAddProduct(product: Product) {
    if (!takeId) return;
    // Default actual_count = expected (user sửa sau). Reason để null lúc add.
    setActionPending("add");
    setError(null);
    try {
      await stockTakeSync.addItem(takeId, product.id, product.stock);
      beep(880, 80);
      vibrate(40);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thêm thất bại");
    } finally {
      setActionPending(null);
    }
  }

  async function handleScanned(barcode: string) {
    setShowScanner(false);
    if (!orgId) return;
    const product = await db.products.where({ orgId, barcode }).first();
    if (!product || !product.isActive) {
      setError(`Mã ${barcode} chưa có trong sản phẩm`);
      return;
    }
    // Đã có trong list → không add lần 2 (avoid duplicate row)
    if (items.some((it) => it.productId === product.id)) {
      setError(`${product.name} đã có trong phiếu`);
      return;
    }
    await handleAddProduct(product);
  }

  async function handleUpdateActual(itemId: string, value: number) {
    setError(null);
    try {
      await stockTakeSync.updateItem(itemId, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cập nhật thất bại");
    }
  }

  async function handleUpdateReason(itemId: string, reason: string) {
    setError(null);
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    try {
      await stockTakeSync.updateItem(itemId, item.actualCount, reason);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cập nhật reason thất bại");
    }
  }

  async function handleRemove(itemId: string) {
    setError(null);
    try {
      await stockTakeSync.removeItem(itemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xóa thất bại");
    }
  }

  async function handleCommit() {
    if (!takeId) return;
    setActionPending("commit");
    setError(null);
    try {
      await stockTakeSync.commit(takeId);
      vibrate([60, 40, 60]);
      navigate("/inventory", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hoàn tất thất bại");
      setActionPending(null);
      setConfirmCommit(false);
    }
  }

  async function handleCancel() {
    if (!takeId) return;
    if (!confirm("Hủy phiếu kiểm kê? (giữ items để audit)")) return;
    setActionPending("cancel");
    try {
      await stockTakeSync.cancel(takeId);
      navigate("/inventory", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hủy thất bại");
      setActionPending(null);
    }
  }

  const totalDelta = items.reduce((sum, it) => sum + it.deltaValue, 0);
  const totalDeltaSign =
    totalDelta > 0
      ? "text-primary-700"
      : totalDelta < 0
        ? "text-danger"
        : "text-ink-muted";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg flex items-start gap-3">
        <Link
          to="/inventory"
          className="p-2 -ml-2 rounded text-ink-muted hover:bg-bg-subtle press"
          aria-label="Quay lại"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg md:text-xl font-semibold">
              Kiểm kê {formatDate(take.takeDate)}
            </h1>
            <span
              className={cn(
                "px-2 py-0.5 rounded text-xs font-medium",
                badge.cls,
              )}
            >
              {badge.label}
            </span>
          </div>
          {take.notes && (
            <p className="text-xs text-ink-muted truncate">{take.notes}</p>
          )}
        </div>
      </div>

      {/* Status banner cho committed/cancelled */}
      {!isInProgress && (
        <div
          className={cn(
            "px-4 md:px-6 py-2 text-sm border-b",
            take.status === "committed"
              ? "bg-primary-50 border-primary-100 text-primary-800"
              : "bg-bg-subtle border-line text-ink-muted",
          )}
        >
          {take.status === "committed"
            ? `Đã cập nhật tồn kho theo số đếm thực tế. Read-only.`
            : `Phiếu đã bị hủy. Read-only.`}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 pb-32 space-y-3">
        {items.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed border-line rounded-lg bg-bg">
            <ClipboardCheck className="w-10 h-10 text-ink-subtle mx-auto mb-2" />
            <p className="text-sm text-ink-muted">
              {isInProgress
                ? "Quét mã hoặc tìm sản phẩm để bắt đầu đếm"
                : "Phiếu này không có sản phẩm nào"}
            </p>
          </div>
        ) : (
          items.map((it) => (
            <StockTakeItemRow
              key={it.id}
              item={it}
              editable={isInProgress}
              onUpdateActual={(v) => handleUpdateActual(it.id, v)}
              onUpdateReason={(r) => handleUpdateReason(it.id, r)}
              onRemove={() => handleRemove(it.id)}
            />
          ))
        )}

        {isInProgress && (
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => setShowScanner(true)}
              disabled={actionPending !== null}
              className="w-full"
            >
              <Camera className="w-5 h-5" />
              Quét mã
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowPicker(true)}
              disabled={actionPending !== null}
              className="w-full"
            >
              <Search className="w-5 h-5" />
              Tìm sản phẩm
            </Button>
          </div>
        )}

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      {/* Footer sticky — totals + actions */}
      <div className="fixed bottom-16 md:bottom-0 left-0 right-0 md:left-60 border-t border-line bg-bg-card px-4 md:px-6 py-3 z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-ink-muted">
              {items.length} sản phẩm · Chênh lệch
            </p>
            <p
              className={cn(
                "text-lg font-semibold font-mono tabular-nums",
                totalDeltaSign,
              )}
            >
              {totalDelta > 0 && "+"}
              {formatVND(totalDelta)}đ
            </p>
          </div>
          {isInProgress && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={handleCancel}
                disabled={actionPending !== null}
                loading={actionPending === "cancel"}
              >
                Hủy
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => setConfirmCommit(true)}
                disabled={items.length === 0 || actionPending !== null}
              >
                Hoàn tất
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Confirm commit sheet */}
      <Sheet
        open={confirmCommit}
        onClose={() => !actionPending && setConfirmCommit(false)}
        title="Xác nhận hoàn tất kiểm kê"
      >
        <div className="px-5 pb-5 flex flex-col gap-4">
          <div className="bg-bg rounded-lg p-3 text-sm space-y-1">
            <p>
              Sẽ cập nhật <span className="font-semibold">{items.length} sản phẩm</span>
              {" "}theo số đếm thực tế
            </p>
            <p>
              Tổng chênh lệch:{" "}
              <span className={cn("font-mono font-semibold", totalDeltaSign)}>
                {totalDelta > 0 && "+"}
                {formatVND(totalDelta)}đ
              </span>
            </p>
          </div>
          <p className="text-xs text-danger">
            ⚠️ Hành động này KHÔNG HOÀN TÁC. Sau khi hoàn tất, tồn kho sẽ
            được set theo số đếm.
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={() => setConfirmCommit(false)}
              disabled={actionPending !== null}
              className="flex-1"
            >
              Quay lại
            </Button>
            <Button
              variant="primary"
              onClick={handleCommit}
              loading={actionPending === "commit"}
              className="flex-1"
            >
              {actionPending === "commit" ? "Đang cập nhật..." : "Xác nhận hoàn tất"}
            </Button>
          </div>
        </div>
      </Sheet>

      <Sheet
        open={showPicker}
        onClose={() => setShowPicker(false)}
        title="Tìm sản phẩm"
      >
        <div className="h-[70vh] md:h-[60vh]">
          <ProductPicker
            onPick={(p) => {
              if (items.some((it) => it.productId === p.id)) {
                setError(`${p.name} đã có trong phiếu`);
                return;
              }
              handleAddProduct(p);
            }}
            onClose={() => setShowPicker(false)}
          />
        </div>
      </Sheet>

      {showScanner && (
        <Suspense fallback={<ScannerFallback />}>
          <BarcodeScanner
            onScan={handleScanned}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Item row — local component (~80 LOC)
// -----------------------------------------------------------------------------

interface ItemRowProps {
  item: import("@/types").StockTakeItem;
  editable: boolean;
  onUpdateActual: (value: number) => void;
  onUpdateReason: (reason: string) => void;
  onRemove: () => void;
}

function StockTakeItemRow({
  item,
  editable,
  onUpdateActual,
  onUpdateReason,
  onRemove,
}: ItemRowProps) {
  // Local state để debounce update (avoid spam RPC mỗi keystroke)
  const [actualLocal, setActualLocal] = useState(String(item.actualCount));
  // Sync khi external update (vd. realtime)
  useEffect(() => {
    setActualLocal(String(item.actualCount));
  }, [item.actualCount]);

  // Debounce 600ms
  useEffect(() => {
    if (!editable) return;
    const v = Number(actualLocal);
    if (Number.isNaN(v) || v === item.actualCount) return;
    const t = setTimeout(() => onUpdateActual(v), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actualLocal, editable]);

  const deltaSign =
    item.delta > 0
      ? "text-primary-700"
      : item.delta < 0
        ? "text-danger"
        : "text-ink-muted";
  const needsReason = item.delta !== 0;

  return (
    <div className="bg-bg-card border border-line rounded-lg p-3 flex flex-col gap-2.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{item.productName}</p>
          <p className="text-xs text-ink-muted">
            Tồn dự kiến:{" "}
            <span className="font-mono tabular-nums">{item.expectedStock}</span>{" "}
            {item.unit}
          </p>
        </div>
        {editable && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Xóa khỏi phiếu"
            className="p-1.5 rounded text-ink-muted hover:bg-danger-bg hover:text-danger press flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-muted">Số đếm thực tế</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={actualLocal}
            disabled={!editable}
            onChange={(e) => setActualLocal(e.target.value)}
            className="h-touch px-3 rounded-lg border border-line bg-bg-card font-mono tabular-nums text-base focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-60"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-muted">Chênh lệch</span>
          <div
            className={cn(
              "h-touch flex items-center px-3 font-mono tabular-nums text-base font-semibold",
              deltaSign,
            )}
          >
            {item.delta > 0 ? "+" : ""}
            {item.delta} {item.unit}
          </div>
        </div>
      </div>

      {needsReason && (
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-muted">
            Lý do (chênh ≠ 0)
          </span>
          <select
            value={item.reason ?? ""}
            disabled={!editable}
            onChange={(e) => onUpdateReason(e.target.value)}
            className="w-full h-touch px-3 rounded-lg border border-line bg-bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-60"
          >
            <option value="">— Chưa chọn —</option>
            {Object.entries(REASON_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}

      {item.deltaValue !== 0 && (
        <div className="flex items-center gap-1 text-xs pt-1 border-t border-line/50">
          <CheckCircle2 className="w-3.5 h-3.5 text-ink-subtle" />
          <span className="text-ink-muted">Giá trị chênh:</span>
          <span
            className={cn(
              "font-mono tabular-nums font-semibold",
              deltaSign,
            )}
          >
            {item.deltaValue > 0 && "+"}
            {formatVND(item.deltaValue)}đ
          </span>
        </div>
      )}
    </div>
  );
}
