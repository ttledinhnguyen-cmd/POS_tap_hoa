import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Banknote, Building2, QrCode, Search } from "lucide-react";
import { db } from "@/lib/db";
import { useAuthStore } from "@/stores/auth";
import {
  PERIOD_LABEL,
  PeriodTabs,
  periodRange,
  type Period,
} from "@/components/PeriodTabs";
import { OrderDetailSheet } from "@/components/orders/OrderDetailSheet";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order } from "@/types";

const PAYMENT_ICON: Record<string, React.ReactNode> = {
  cash: <Banknote className="w-3.5 h-3.5" />,
  transfer: <Building2 className="w-3.5 h-3.5" />,
  qr: <QrCode className="w-3.5 h-3.5" />,
  mixed: <Banknote className="w-3.5 h-3.5" />,
};

const INVOICE_BADGE: Record<
  Order["invoiceStatus"],
  { label: string; cls: string } | null
> = {
  none: null,
  pending: { label: "Đang phát hành", cls: "bg-accent/10 text-accent" },
  issued: { label: "Đã HĐ", cls: "bg-primary-50 text-primary-700" },
  failed: { label: "Lỗi HĐ", cls: "bg-danger-bg text-danger" },
  cancelled: { label: "Đã hủy", cls: "bg-bg-subtle text-ink-muted" },
};

/**
 * Format thời gian compact:
 *   - Cùng ngày hôm nay: HH:mm
 *   - Khác ngày: DD/MM HH:mm
 */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return time;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
}

export function OrdersPage() {
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [period, setPeriod] = useState<Period>("today");
  const [query, setQuery] = useState("");
  const [openOrder, setOpenOrder] = useState<Order | null>(null);

  const [startMs, endMs] = useMemo(() => periodRange(period), [period]);

  const orders = useLiveQuery(
    async () => {
      if (!orgId) return [];
      const list = await db.orders
        .where("[orgId+createdAt]")
        .between([orgId, startMs], [orgId, endMs], true, true)
        .toArray();
      return list.sort((a, b) => b.createdAt - a.createdAt);
    },
    [orgId, startMs, endMs],
    [],
  );

  // Pull items của tất cả orders trong list để hiển thị summary tên item đầu
  const itemsByOrder = useLiveQuery(
    async () => {
      if (orders.length === 0) return new Map<string, number>();
      const ids = orders.map((o) => o.id);
      const items = await db.orderItems.where("orderId").anyOf(ids).toArray();
      const map = new Map<string, { firstName: string; count: number }>();
      for (const it of items) {
        const cur = map.get(it.orderId);
        if (!cur) {
          map.set(it.orderId, { firstName: it.productName, count: 1 });
        } else {
          cur.count += 1;
        }
      }
      return map;
    },
    [orders],
    new Map(),
  );

  // Search filter
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const idMatch = o.id.toLowerCase().includes(q);
      const phoneMatch = o.customerPhone?.toLowerCase().includes(q);
      const nameMatch = o.customerName?.toLowerCase().includes(q);
      return idMatch || phoneMatch || nameMatch;
    });
  }, [orders, query]);

  // Footer totals
  const totalRevenue = filtered.reduce((sum, o) => sum + o.total, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg">
        <h1 className="text-lg md:text-xl font-semibold">Lịch sử đơn hàng</h1>
        <p className="text-xs text-ink-muted">
          Xem chi tiết đơn + thông tin thanh toán
        </p>
      </div>

      {/* Period tabs */}
      <div className="px-4 md:px-6 py-3 border-b border-line bg-bg">
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>

      {/* Search */}
      <div className="px-4 md:px-6 py-3 border-b border-line bg-bg">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm mã đơn (6 ký tự cuối) hoặc số điện thoại khách..."
            className="w-full pl-9 pr-3 h-touch rounded-lg border border-line bg-bg-card focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3 pb-32 md:pb-20">
        {orders.length === 0 ? (
          <p className="text-center text-ink-muted py-12 text-sm">
            {PERIOD_LABEL[period]} chưa có đơn nào.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-ink-muted py-12 text-sm">
            Không tìm thấy đơn khớp "{query}".
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((o) => {
              const summary = itemsByOrder.get(o.id);
              const badge = INVOICE_BADGE[o.invoiceStatus];
              return (
                <li
                  key={o.id}
                  onClick={() => setOpenOrder(o)}
                  className={cn(
                    "bg-bg-card border border-line rounded-lg p-3 press cursor-pointer",
                    "hover:border-line-strong",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono tabular-nums text-ink-subtle">
                          #{o.id.slice(-6).toUpperCase()}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {formatTime(o.createdAt)}
                        </span>
                        {badge && (
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium",
                              badge.cls,
                            )}
                          >
                            {badge.label}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium truncate">
                        {summary
                          ? summary.count > 1
                            ? `${summary.firstName} +${summary.count - 1} khác`
                            : summary.firstName
                          : "Chưa có chi tiết"}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-mono tabular-nums font-semibold text-primary-700">
                        {formatVND(o.total)}đ
                      </p>
                      <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                        {PAYMENT_ICON[o.paymentMethod]}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer total */}
      {filtered.length > 0 && (
        <div className="border-t border-line bg-bg-card px-4 md:px-6 py-3 safe-bottom">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">
              {filtered.length} đơn ·{" "}
              {query ? `khớp "${query}"` : PERIOD_LABEL[period]}
            </span>
            <span className="font-mono tabular-nums font-semibold text-primary-700">
              {formatVND(totalRevenue)}đ
            </span>
          </div>
        </div>
      )}

      <OrderDetailSheet
        open={openOrder !== null}
        onClose={() => setOpenOrder(null)}
        order={openOrder}
      />
    </div>
  );
}
