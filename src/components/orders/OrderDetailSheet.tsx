import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, Building2, Printer, QrCode } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { RoleGate } from "@/components/RoleGate";
import { db } from "@/lib/db";
import { ordersSync } from "@/integrations/sync/orders-sync";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  order: Order | null;
}

const PAYMENT_LABEL: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  qr: "QR thanh toán",
  mixed: "Hỗn hợp",
};

const PAYMENT_ICON: Record<string, React.ReactNode> = {
  cash: <Banknote className="w-4 h-4" />,
  transfer: <Building2 className="w-4 h-4" />,
  qr: <QrCode className="w-4 h-4" />,
  mixed: <Banknote className="w-4 h-4" />,
};

const INVOICE_BADGE: Record<
  Order["invoiceStatus"],
  { label: string; cls: string } | null
> = {
  none: null,
  pending: {
    label: "Đang phát hành",
    cls: "bg-accent/10 text-accent border-accent/20",
  },
  issued: {
    label: "Đã phát hành",
    cls: "bg-primary-50 text-primary-700 border-primary-100",
  },
  failed: {
    label: "Lỗi phát hành",
    cls: "bg-danger-bg text-danger border-danger/20",
  },
  cancelled: {
    label: "Đã hủy",
    cls: "bg-bg-subtle text-ink-muted border-line",
  },
};

function formatFullDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function OrderDetailSheet({ open, onClose, order }: Props) {
  const [pulling, setPulling] = useState(false);

  // Items reactive — Dexie có gì show nấy
  const items = useLiveQuery(
    async () => {
      if (!order) return [];
      return await db.orderItems.where("orderId").equals(order.id).toArray();
    },
    [order?.id],
    [],
  );

  // Lần đầu mở: nếu Dexie chưa có items (vd. order ngoài 30-day pull window
  // hoặc realtime INSERT chưa kịp pullOrderItems), fetch ngay
  useEffect(() => {
    if (!open || !order) return;
    let cancelled = false;
    (async () => {
      const cached = await db.orderItems
        .where("orderId")
        .equals(order.id)
        .count();
      if (cached > 0 || cancelled) return;
      setPulling(true);
      try {
        await ordersSync.pullOrderItems(order.id);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn("[OrderDetailSheet] pullOrderItems failed:", err);
        }
      } finally {
        if (!cancelled) setPulling(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, order?.id]);

  if (!order) return null;

  const idShort = order.id.slice(-6).toUpperCase();
  const badge = INVOICE_BADGE[order.invoiceStatus];

  // Lãi gộp = sum(line_total) - sum(quantity × price_buy)
  const grossProfit = items.reduce(
    (sum, it) => sum + (it.lineTotal - it.priceBuy * it.quantity),
    0,
  );

  return (
    <Sheet open={open} onClose={onClose} title={`Đơn #${idShort}`}>
      <div className="px-5 pb-5 flex flex-col gap-4">
        {/* Time + status badge */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-ink-muted">
            {formatFullDateTime(order.createdAt)}
          </p>
          {badge && (
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-[11px] font-medium border",
                badge.cls,
              )}
            >
              {badge.label}
            </span>
          )}
        </div>

        {/* Items list */}
        <section>
          <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
            Mặt hàng ({items.length})
          </h3>
          {pulling && items.length === 0 ? (
            <p className="text-sm text-ink-muted py-3">Đang tải chi tiết...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-ink-muted py-3">Không có chi tiết</p>
          ) : (
            <ul className="bg-bg-subtle/50 rounded-lg divide-y divide-line">
              {items.map((it) => (
                <li key={it.id} className="px-3 py-2.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight">
                      {it.productName}
                    </p>
                    <p className="text-xs text-ink-muted mt-0.5 font-mono tabular-nums">
                      {it.quantity} {it.unit} × {formatVND(it.priceSell)}đ
                    </p>
                  </div>
                  <p className="text-sm font-mono tabular-nums font-medium flex-shrink-0">
                    {formatVND(it.lineTotal)}đ
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Totals */}
        <section className="bg-bg-subtle/50 rounded-lg p-3 text-sm space-y-1.5">
          <Row label="Tạm tính" value={`${formatVND(order.subtotal)}đ`} />
          {order.discount > 0 && (
            <Row label="Giảm giá" value={`-${formatVND(order.discount)}đ`} />
          )}
          {order.taxAmount > 0 && (
            <Row label="Thuế GTGT" value={`${formatVND(order.taxAmount)}đ`} />
          )}
          <div className="border-t border-line pt-1.5">
            <Row
              label="TỔNG CỘNG"
              value={
                <span className="text-money font-mono tabular-nums text-primary-700 font-semibold">
                  {formatVND(order.total)}đ
                </span>
              }
              bold
            />
          </div>
        </section>

        {/* Payment */}
        <section>
          <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
            Thanh toán
          </h3>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-primary-700">
              {PAYMENT_ICON[order.paymentMethod]}
            </span>
            <span className="font-medium">
              {PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}
            </span>
          </div>
          {order.paymentMethod === "cash" && order.cashReceived != null && (
            <div className="mt-1.5 text-sm space-y-1">
              <Row
                label="Khách đưa"
                value={`${formatVND(order.cashReceived)}đ`}
              />
              {(order.changeAmount ?? 0) > 0 && (
                <Row
                  label="Tiền thối"
                  value={
                    <span className="text-accent font-mono tabular-nums">
                      {formatVND(order.changeAmount!)}đ
                    </span>
                  }
                />
              )}
            </div>
          )}
        </section>

        {/* Customer (nếu có) */}
        {(order.customerName ||
          order.customerPhone ||
          order.customerTaxCode) && (
          <section>
            <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
              Khách hàng
            </h3>
            <div className="text-sm space-y-1">
              {order.customerName && (
                <Row label="Tên" value={order.customerName} />
              )}
              {order.customerPhone && (
                <Row label="Số điện thoại" value={order.customerPhone} />
              )}
              {order.customerTaxCode && (
                <Row label="MST" value={order.customerTaxCode} />
              )}
            </div>
          </section>
        )}

        {/* Invoice info */}
        {order.invoiceStatus !== "none" && (
          <section>
            <h3 className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">
              Hóa đơn điện tử
            </h3>
            {order.invoiceStatus === "issued" && order.invoiceNo && (
              <div className="text-sm space-y-1">
                <Row label="Số HĐ" value={order.invoiceNo} />
                {order.invoiceLookupCode && (
                  <Row label="Mã tra cứu" value={order.invoiceLookupCode} />
                )}
              </div>
            )}
            {order.invoiceStatus === "pending" && (
              <p className="text-sm text-ink-muted">
                Đang phát hành hóa đơn... Sẽ tự cập nhật khi xong.
              </p>
            )}
            {order.invoiceStatus === "failed" && (
              <p className="text-sm text-danger">
                Phát hành thất bại. Sẽ thử lại tự động.
              </p>
            )}
          </section>
        )}

        {/* Lãi gộp đơn này — owner only */}
        <RoleGate allow={["owner"]}>
          {items.length > 0 && (
            <section className="bg-primary-50 border border-primary-100 rounded-lg p-3">
              <Row
                label="Lãi gộp đơn này"
                value={
                  <span className="font-mono tabular-nums font-semibold text-primary-700">
                    {formatVND(grossProfit)}đ
                  </span>
                }
              />
            </section>
          )}
        </RoleGate>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            disabled
            title="Cần kết nối máy in (Sprint sau)"
            className="flex-1"
          >
            <Printer className="w-4 h-4" />
            In hóa đơn
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="flex-1"
          >
            Đóng
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className={cn(
          "text-ink-muted",
          bold && "text-ink font-semibold uppercase text-xs tracking-wide",
        )}
      >
        {label}
      </span>
      <span className={cn("font-mono tabular-nums", bold && "text-base")}>
        {value}
      </span>
    </div>
  );
}
