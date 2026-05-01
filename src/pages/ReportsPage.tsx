import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  ArrowRight,
  Receipt,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { db } from "@/lib/db";
import { useAuthStore } from "@/stores/auth";
import { RoleGate } from "@/components/RoleGate";
import {
  PERIOD_LABEL,
  PeriodTabs,
  periodRange,
  type Period,
} from "@/components/PeriodTabs";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";

const STOCK_LOW_THRESHOLD = 10;

export function ReportsPage() {
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [period, setPeriod] = useState<Period>("today");

  const [startMs, endMs] = useMemo(() => periodRange(period), [period]);

  // Pull orders trong range
  const orders = useLiveQuery(
    async () => {
      if (!orgId) return [];
      return await db.orders
        .where("[orgId+createdAt]")
        .between([orgId, startMs], [orgId, endMs], true, true)
        .toArray();
    },
    [orgId, startMs, endMs],
    [],
  );

  // Pull items của các orders trong range
  const items = useLiveQuery(
    async () => {
      if (!orders || orders.length === 0) return [];
      const ids = orders.map((o) => o.id);
      return await db.orderItems.where("orderId").anyOf(ids).toArray();
    },
    [orders],
    [],
  );

  // Stock alerts (tách riêng — không phụ thuộc period)
  const lowStockProducts = useLiveQuery(
    async () => {
      if (!orgId) return [];
      const list = await db.products.where({ orgId }).toArray();
      return list.filter(
        (p) => p.isActive && p.stock < STOCK_LOW_THRESHOLD && p.stock >= 0,
      );
    },
    [orgId],
    [],
  );

  const negativeStockProducts = useLiveQuery(
    async () => {
      if (!orgId) return [];
      const list = await db.products.where({ orgId }).toArray();
      return list.filter((p) => p.isActive && p.stock < 0);
    },
    [orgId],
    [],
  );

  // Computed metrics
  const revenue = orders.reduce((sum, o) => sum + o.total, 0);
  const totalDiscount = orders.reduce((sum, o) => sum + o.discount, 0);
  const orderCount = orders.length;
  const grossProfit = items.reduce((sum, it) => {
    return sum + (it.lineTotal - it.priceBuy * it.quantity);
  }, 0);

  // Top sản phẩm bán chạy (group by productId hoặc productName nếu null)
  const topProducts = useMemo(() => {
    const map = new Map<
      string,
      { name: string; quantity: number; revenue: number }
    >();
    for (const it of items) {
      const key = it.productId ?? `__name:${it.productName}`;
      const cur = map.get(key) ?? {
        name: it.productName,
        quantity: 0,
        revenue: 0,
      };
      cur.quantity += it.quantity;
      cur.revenue += it.lineTotal;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
  }, [items]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg">
        <h1 className="text-lg md:text-xl font-semibold">Báo cáo</h1>
        <p className="text-xs text-ink-muted">Doanh thu + sản phẩm bán chạy</p>
      </div>

      {/* Period tabs */}
      <div className="px-4 md:px-6 py-3 border-b border-line bg-bg">
        <PeriodTabs value={period} onChange={setPeriod} />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-4 pb-24 md:pb-6">
        {orderCount === 0 ? (
          <p className="text-center text-ink-muted py-12 text-sm">
            {PERIOD_LABEL[period]} chưa có đơn hàng nào.
          </p>
        ) : (
          <>
            {/* Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Card
                icon={<TrendingUp className="w-5 h-5 text-primary-700" />}
                label="Doanh thu"
                value={`${formatVND(revenue)}đ`}
                subtitle={`${orderCount} đơn`}
              />
              <Card
                icon={<Receipt className="w-5 h-5 text-ink-muted" />}
                label="Số đơn"
                value={String(orderCount)}
                subtitle=""
              />
              <RoleGate allow={["owner"]}>
                <Card
                  icon={<TrendingUp className="w-5 h-5 text-primary-700" />}
                  label="Lãi gộp"
                  value={`${formatVND(grossProfit)}đ`}
                  subtitle={
                    revenue > 0
                      ? `${Math.round((grossProfit / revenue) * 100)}% biên`
                      : ""
                  }
                />
                <Card
                  icon={<TrendingDown className="w-5 h-5 text-accent" />}
                  label="Đã giảm giá"
                  value={`${formatVND(totalDiscount)}đ`}
                  subtitle=""
                />
              </RoleGate>
            </div>

            {/* Top products */}
            <section className="mb-6">
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">
                Sản phẩm bán chạy
              </h2>
              <ul className="bg-bg-card border border-line rounded-lg divide-y divide-line">
                {topProducts.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-mono w-5 text-ink-subtle">
                        {i + 1}
                      </span>
                      <p className="text-sm font-medium truncate">{p.name}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-mono tabular-nums">
                        {p.quantity.toLocaleString("vi-VN")}
                      </p>
                      <p className="text-xs text-ink-subtle font-mono tabular-nums">
                        {formatVND(p.revenue)}đ
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* CTA xem chi tiết đơn hàng */}
            <Link
              to="/orders"
              className={cn(
                "flex items-center justify-between bg-bg-card border border-line rounded-lg",
                "px-4 py-3 mb-6 press hover:border-line-strong",
              )}
            >
              <div className="flex items-center gap-3">
                <Receipt className="w-5 h-5 text-primary-700 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium">Xem tất cả đơn hàng</p>
                  <p className="text-xs text-ink-muted">
                    Lịch sử + chi tiết từng đơn
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-ink-subtle flex-shrink-0" />
            </Link>
          </>
        )}

        {/* Stock alerts — owner only */}
        <RoleGate allow={["owner"]}>
          {(lowStockProducts.length > 0 || negativeStockProducts.length > 0) && (
            <section>
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">
                Cảnh báo tồn kho
              </h2>
              {negativeStockProducts.length > 0 && (
                <AlertList
                  variant="danger"
                  title={`${negativeStockProducts.length} sản phẩm tồn kho ÂM`}
                  items={negativeStockProducts.map((p) => ({
                    name: p.name,
                    detail: `${p.stock} ${p.unit}`,
                  }))}
                />
              )}
              {lowStockProducts.length > 0 && (
                <AlertList
                  variant="warn"
                  title={`${lowStockProducts.length} sản phẩm sắp hết (< ${STOCK_LOW_THRESHOLD})`}
                  items={lowStockProducts.map((p) => ({
                    name: p.name,
                    detail: `Còn ${p.stock} ${p.unit}`,
                  }))}
                />
              )}
            </section>
          )}
        </RoleGate>
      </div>
    </div>
  );
}

interface CardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
}

function Card({ icon, label, value, subtitle }: CardProps) {
  return (
    <div className="bg-bg-card border border-line rounded-lg p-4">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <p className="text-xs text-ink-muted uppercase tracking-wide font-medium">
          {label}
        </p>
      </div>
      <p className="text-lg font-mono tabular-nums font-semibold">{value}</p>
      {subtitle && <p className="text-xs text-ink-subtle mt-0.5">{subtitle}</p>}
    </div>
  );
}

interface AlertListProps {
  variant: "warn" | "danger";
  title: string;
  items: { name: string; detail: string }[];
}

function AlertList({ variant, title, items }: AlertListProps) {
  return (
    <div
      className={cn(
        "rounded-lg p-3 mb-3 border",
        variant === "danger"
          ? "bg-danger-bg border-danger/30"
          : "bg-bg-card border-line",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle
          className={cn(
            "w-4 h-4",
            variant === "danger" ? "text-danger" : "text-accent",
          )}
        />
        <p
          className={cn(
            "text-sm font-medium",
            variant === "danger" ? "text-danger" : "text-ink",
          )}
        >
          {title}
        </p>
      </div>
      <ul className="space-y-1">
        {items.slice(0, 5).map((it, i) => (
          <li
            key={i}
            className="text-xs flex justify-between text-ink-muted"
          >
            <span className="truncate flex-1">{it.name}</span>
            <span className="font-mono ml-2 flex-shrink-0">{it.detail}</span>
          </li>
        ))}
        {items.length > 5 && (
          <li className="text-xs text-ink-subtle italic">
            …và {items.length - 5} mặt khác
          </li>
        )}
      </ul>
    </div>
  );
}
