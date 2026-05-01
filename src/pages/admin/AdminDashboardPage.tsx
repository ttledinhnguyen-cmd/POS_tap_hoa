import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Building2,
  DollarSign,
  Loader2,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DashboardMetrics, ShopWithStats } from "@/types";

const STATUS_LABEL: Record<ShopWithStats["status"], { label: string; cls: string }> = {
  trial: { label: "Trial", cls: "bg-accent/10 text-accent" },
  active: { label: "Active", cls: "bg-primary-50 text-primary-700" },
  expired: { label: "Hết hạn", cls: "bg-danger-bg text-danger" },
  suspended: { label: "Tạm khóa", cls: "bg-bg-subtle text-ink-muted" },
  cancelled: { label: "Hủy", cls: "bg-bg-subtle text-ink-subtle" },
};

function MetricCard({
  label,
  value,
  icon: Icon,
  color = "text-primary-700",
}: {
  label: string;
  value: string | number;
  icon: typeof DollarSign;
  color?: string;
}) {
  return (
    <div className="bg-bg-card border border-line rounded-lg p-4 flex items-start gap-3">
      <div className={cn("p-2 rounded-md bg-bg", color)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-ink-muted">{label}</p>
        <p className="text-lg font-semibold font-mono tabular-nums truncate">
          {value}
        </p>
      </div>
    </div>
  );
}

/**
 * Days until trial/paid expires. < 0 nếu đã quá hạn.
 */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / (24 * 3600 * 1000));
}

export function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [shops, setShops] = useState<ShopWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [m, s] = await Promise.all([
          supabase.rpc("admin_dashboard_metrics"),
          supabase.rpc("admin_list_shops"),
        ]);
        if (cancelled) return;
        if (m.error) throw m.error;
        if (s.error) throw s.error;
        setMetrics(m.data as DashboardMetrics);
        setShops((s.data ?? []) as ShopWithStats[]);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Tải dữ liệu thất bại");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Top 10 shops by revenue
  const topByRevenue = [...shops]
    .sort((a, b) => b.total_revenue - a.total_revenue)
    .slice(0, 10);

  // Cần chú ý: trial < 3 ngày, expired, suspended
  const needAttention = shops.filter((s) => {
    if (s.status === "expired" || s.status === "suspended") return true;
    if (s.status === "trial") {
      const d = daysUntil(s.trial_until_date);
      return d !== null && d <= 3;
    }
    return false;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-primary-700" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg">
        <h1 className="text-lg md:text-xl font-semibold flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary-700" />
          Tổng quan quản trị
        </h1>
        <p className="text-xs text-ink-muted">
          Theo dõi subscriptions + doanh thu các tiệm khách
        </p>
      </div>

      <div className="p-4 md:p-6 space-y-6">
        {/* Metrics grid */}
        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Tổng số tiệm"
              value={metrics.total_shops}
              icon={Building2}
            />
            <MetricCard
              label="MRR"
              value={`${formatVND(metrics.mrr)}đ`}
              icon={DollarSign}
              color="text-primary-700"
            />
            <MetricCard
              label="Active"
              value={metrics.active_shops}
              icon={TrendingUp}
              color="text-primary-700"
            />
            <MetricCard
              label="Trial"
              value={metrics.trial_shops}
              icon={Users}
              color="text-accent"
            />
            <MetricCard
              label="Hết hạn"
              value={metrics.expired_shops}
              icon={AlertCircle}
              color="text-danger"
            />
            <MetricCard
              label="Tạm khóa"
              value={metrics.suspended_shops}
              icon={AlertCircle}
              color="text-ink-muted"
            />
            <MetricCard
              label="Đăng ký tháng này"
              value={metrics.signups_this_month}
              icon={Users}
            />
            <MetricCard
              label="Doanh thu tất cả"
              value={`${formatVND(metrics.total_revenue_all_shops)}đ`}
              icon={DollarSign}
            />
          </div>
        )}

        {/* Need attention */}
        {needAttention.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-danger" />
              Cần chú ý ({needAttention.length})
            </h2>
            <ul className="border border-line rounded-lg divide-y divide-line/60 overflow-hidden bg-bg-card">
              {needAttention.map((s) => {
                const trialDays = daysUntil(s.trial_until_date);
                const badge = STATUS_LABEL[s.status];
                return (
                  <li key={s.org_id}>
                    <Link
                      to={`/admin/shops/${s.org_id}`}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg-subtle press"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {s.org_name}
                        </p>
                        <p className="text-xs text-ink-muted truncate">
                          {s.owner_email}
                          {s.status === "trial" && trialDays !== null && (
                            <>
                              {" · "}
                              <span className="text-accent">
                                Trial còn {trialDays} ngày
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-medium",
                          badge.cls,
                        )}
                      >
                        {badge.label}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Top revenue */}
        <section>
          <h2 className="text-sm font-semibold mb-2">
            Top 10 tiệm theo doanh thu
          </h2>
          {topByRevenue.length === 0 ? (
            <p className="text-sm text-ink-muted py-4 text-center">
              Chưa có dữ liệu doanh thu.
            </p>
          ) : (
            <ul className="border border-line rounded-lg divide-y divide-line/60 overflow-hidden bg-bg-card">
              {topByRevenue.map((s, idx) => (
                <li key={s.org_id}>
                  <Link
                    to={`/admin/shops/${s.org_id}`}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-bg-subtle press"
                  >
                    <span className="w-6 text-xs font-mono tabular-nums text-ink-subtle text-right">
                      #{idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {s.org_name}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {s.orders_count} đơn · {s.products_count} sản phẩm
                      </p>
                    </div>
                    <p className="text-sm font-mono tabular-nums font-semibold text-primary-700 flex-shrink-0">
                      {formatVND(s.total_revenue)}đ
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
