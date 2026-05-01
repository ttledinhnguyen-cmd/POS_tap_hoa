import { useState } from "react";
import { Banknote, QrCode, Building2, Check } from "lucide-react";
import { useCart } from "@/stores/cart";
import { useAuthStore } from "@/stores/auth";
import { ordersSync } from "@/integrations/sync/orders-sync";
import { outboxWorker } from "@/integrations/sync/outbox-worker";
import { formatVND, parseVND } from "@/lib/format";
import { vibrate } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type Method = "cash" | "transfer" | "qr";

interface Props {
  onDone: () => void;
}

export function PaymentSheet({ onDone }: Props) {
  const items = useCart((s) => s.items);
  const total = useCart((s) => s.total)();
  const taxAmount = useCart((s) => s.taxAmount)();
  const clear = useCart((s) => s.clear);

  const orgId = useAuthStore((s) => s.currentOrgId);

  const [method, setMethod] = useState<Method>("cash");
  const [cashInput, setCashInput] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const cash = parseVND(cashInput);
  const change = method === "cash" && cash >= total ? cash - total : 0;
  const canConfirm =
    !submitting && (method !== "cash" || cash >= total) && items.length > 0;

  const handleConfirm = async () => {
    if (!orgId || items.length === 0) return;
    setError(undefined);
    setSubmitting(true);
    try {
      // Optimistic write Dexie + outbox queue. Server RPC chạy background.
      await ordersSync.createOrder({
        orgId,
        paymentMethod: method,
        cashReceived: method === "cash" ? cash : undefined,
        changeAmount: method === "cash" ? change : undefined,
        subtotal: total - taxAmount,
        taxAmount,
        total,
        items,
      });
      // Trigger drain ngay (UX feedback nhanh khi online)
      outboxWorker.drainNow();
      vibrate([60, 40, 60]);
      setDone(true);
      setTimeout(() => {
        clear();
        onDone();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lưu đơn thất bại");
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6">
        <div className="w-20 h-20 rounded-full bg-primary-100 flex items-center justify-center mb-4 animate-in zoom-in">
          <Check className="w-10 h-10 text-primary-700" strokeWidth={2.5} />
        </div>
        <h3 className="text-xl font-semibold mb-1">Đã thanh toán</h3>
        {change > 0 && (
          <p className="text-ink-muted">
            Thối lại{" "}
            <span className="font-mono font-semibold text-accent">
              {formatVND(change)}đ
            </span>
          </p>
        )}
      </div>
    );
  }

  // Quick-pick các mệnh giá thông dụng
  const quickAmounts = getQuickAmounts(total);

  return (
    <div className="flex flex-col">
      {/* Tổng tiền */}
      <div className="px-5 py-4 border-b border-line">
        <p className="text-sm text-ink-muted">Tổng cộng</p>
        <p className="text-money-lg font-mono tabular-nums text-primary-700">
          {formatVND(total)}đ
        </p>
        {taxAmount > 0 && (
          <p className="text-xs text-ink-subtle mt-1">
            Đã bao gồm thuế GTGT{" "}
            <span className="font-mono">{formatVND(taxAmount)}đ</span>
          </p>
        )}
      </div>

      {/* Chọn phương thức */}
      <div className="px-5 py-4">
        <p className="text-sm font-medium text-ink-muted mb-2">
          Hình thức thanh toán
        </p>
        <div className="grid grid-cols-3 gap-2">
          <MethodButton
            active={method === "cash"}
            onClick={() => setMethod("cash")}
            icon={<Banknote className="w-5 h-5" />}
            label="Tiền mặt"
          />
          <MethodButton
            active={method === "transfer"}
            onClick={() => setMethod("transfer")}
            icon={<Building2 className="w-5 h-5" />}
            label="Chuyển khoản"
          />
          <MethodButton
            active={method === "qr"}
            onClick={() => setMethod("qr")}
            icon={<QrCode className="w-5 h-5" />}
            label="QR"
          />
        </div>
      </div>

      {/* Nhập tiền mặt */}
      {method === "cash" && (
        <div className="px-5 pb-2">
          <label className="text-sm font-medium text-ink-muted">
            Khách đưa
          </label>
          <input
            type="text"
            inputMode="numeric"
            value={cashInput ? formatVND(cash) : ""}
            onChange={(e) => setCashInput(e.target.value)}
            placeholder="0"
            className="w-full mt-1 h-touch-lg px-4 rounded-lg border border-line bg-bg-card text-money font-mono tabular-nums focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
          <div className="flex gap-2 mt-2 flex-wrap">
            {quickAmounts.map((amt) => (
              <button
                key={amt}
                onClick={() => setCashInput(formatVND(amt))}
                className="px-3 py-1.5 text-sm font-mono rounded-full bg-bg-subtle hover:bg-line press"
              >
                {formatVND(amt)}
              </button>
            ))}
          </div>
          {cash >= total && change > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-accent/10 border border-accent/20">
              <p className="text-sm text-ink-muted">Thối lại</p>
              <p className="text-money font-mono tabular-nums text-accent">
                {formatVND(change)}đ
              </p>
            </div>
          )}
          {cashInput && cash < total && (
            <p className="mt-2 text-sm text-danger">
              Còn thiếu {formatVND(total - cash)}đ
            </p>
          )}
        </div>
      )}

      {method === "qr" && (
        <div className="px-5 pb-2">
          <div className="aspect-square max-w-xs mx-auto bg-bg-subtle rounded-xl flex items-center justify-center">
            <p className="text-ink-muted text-sm text-center px-4">
              [QR VietQR sẽ hiển thị ở đây
              <br />
              khi tích hợp ngân hàng]
            </p>
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="p-5 pt-3 safe-bottom">
        {error && (
          <p className="text-sm text-danger mb-2" role="alert">
            {error}
          </p>
        )}
        <Button
          onClick={handleConfirm}
          disabled={!canConfirm}
          loading={submitting}
          variant="accent"
          size="lg"
          className="w-full"
        >
          {submitting ? "Đang lưu..." : "Xác nhận thanh toán"}
        </Button>
      </div>
    </div>
  );
}

function MethodButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center justify-center gap-1 py-3 rounded-lg border press",
        active
          ? "border-primary-700 bg-primary-50 text-primary-700"
          : "border-line bg-bg-card text-ink-muted",
      )}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

/** Gợi ý mệnh giá tiền mặt thực tế của VN */
function getQuickAmounts(total: number): number[] {
  const denominations = [
    10000, 20000, 50000, 100000, 200000, 500000, 1000000,
  ];
  // Làm tròn lên đến mệnh giá phù hợp
  const exact = denominations.find((d) => d >= total);
  const candidates = new Set<number>();
  if (exact) candidates.add(exact);
  // Thêm mệnh giá tròn cao hơn
  for (const d of denominations) {
    if (d >= total) {
      candidates.add(d);
      if (candidates.size >= 4) break;
    }
  }
  // Mệnh giá tròn theo total
  if (total <= 50000) candidates.add(50000);
  if (total <= 100000) candidates.add(100000);
  return Array.from(candidates).sort((a, b) => a - b).slice(0, 4);
}
