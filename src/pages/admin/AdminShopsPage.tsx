import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase";
import { Button } from "@/components/ui/Button";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ShopWithStats, SubscriptionStatus } from "@/types";

const STATUS_LABEL: Record<SubscriptionStatus, { label: string; cls: string }> = {
  trial: { label: "Trial", cls: "bg-accent/10 text-accent" },
  active: { label: "Active", cls: "bg-primary-50 text-primary-700" },
  expired: { label: "Hết hạn", cls: "bg-danger-bg text-danger" },
  suspended: { label: "Tạm khóa", cls: "bg-bg-subtle text-ink-muted" },
  cancelled: { label: "Hủy", cls: "bg-bg-subtle text-ink-subtle" },
};
const STATUS_FILTERS: Array<{ value: "all" | SubscriptionStatus; label: string }> = [
  { value: "all", label: "Tất cả" },
  { value: "trial", label: "Trial" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Hết hạn" },
  { value: "suspended", label: "Tạm khóa" },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const days = Math.floor(diff / (24 * 3600 * 1000));
  if (days === 0) return "Hôm nay";
  if (days === 1) return "Hôm qua";
  if (days < 7) return `${days} ngày trước`;
  if (days < 30) return `${Math.floor(days / 7)} tuần trước`;
  return `${Math.floor(days / 30)} tháng trước`;
}

export function AdminShopsPage() {
  const navigate = useNavigate();
  const [shops, setShops] = useState<ShopWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | SubscriptionStatus>(
    "all",
  );
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error: err } = await supabase.rpc("admin_list_shops");
        if (cancelled) return;
        if (err) throw err;
        setShops((data ?? []) as ShopWithStats[]);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Tải shops thất bại");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    let list = shops;
    if (statusFilter !== "all") {
      list = list.filter((s) => s.status === statusFilter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (s) =>
          s.org_name.toLowerCase().includes(q) ||
          s.owner_email.toLowerCase().includes(q),
      );
    }
    return list;
  }, [shops, statusFilter, query]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="flex items-start justify-between gap-3 px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg">
        <div>
          <h1 className="text-lg md:text-xl font-semibold">Cửa hàng</h1>
          <p className="text-xs text-ink-muted">
            {shops.length} tiệm trong hệ thống
          </p>
        </div>
        <Button variant="primary" onClick={() => navigate("/admin/shops/new")}>
          <Plus className="w-5 h-5" />
          <span className="hidden md:inline">Tạo shop mới</span>
          <span className="md:hidden">Tạo</span>
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="px-4 md:px-6 py-3 border-b border-line bg-bg flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm font-medium press min-h-[36px]",
              statusFilter === f.value
                ? "bg-primary-700 text-white"
                : "bg-bg-card border border-line text-ink-muted hover:bg-bg-subtle",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-4 md:px-6 py-3 border-b border-line bg-bg">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tên tiệm hoặc email owner..."
            className="w-full pl-9 pr-3 h-touch rounded-lg border border-line bg-bg-card focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 px-4 md:px-6 py-3 pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary-700" />
          </div>
        ) : error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-ink-muted py-12 text-sm">
            {shops.length === 0
              ? "Chưa có tiệm nào. Tạo shop đầu tiên qua nút trên."
              : `Không có tiệm khớp filter${query ? ` "${query}"` : ""}.`}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((s) => {
              const badge = STATUS_LABEL[s.status];
              return (
                <li key={s.org_id}>
                  <Link
                    to={`/admin/shops/${s.org_id}`}
                    className="block bg-bg-card border border-line rounded-lg p-3 press hover:border-line-strong"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium truncate">
                            {s.org_name}
                          </p>
                          <span
                            className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0",
                              badge.cls,
                            )}
                          >
                            {badge.label}
                          </span>
                        </div>
                        <p className="text-xs text-ink-muted truncate">
                          {s.owner_email}
                        </p>
                        <p className="text-[11px] text-ink-subtle mt-1">
                          {s.status === "trial" && (
                            <>Trial đến {formatDate(s.trial_until_date)} · </>
                          )}
                          {s.status === "active" && (
                            <>Đã trả đến {formatDate(s.paid_until_date)} · </>
                          )}
                          {s.orders_count} đơn · {s.products_count} sản phẩm ·
                          đơn cuối: {formatRelative(s.last_order_at)}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-mono tabular-nums font-semibold text-primary-700">
                          {formatVND(s.total_revenue)}đ
                        </p>
                        <p className="text-[11px] text-ink-subtle">
                          {formatVND(s.monthly_price)}đ/th
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
