import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
} from "lucide-react";
import { api } from "@/integrations/api";
import { Button } from "@/components/ui/Button";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ShopWithStats,
  Subscription,
  SubscriptionPayment,
  SubscriptionStatus,
} from "@/types";

const STATUS_LABEL: Record<SubscriptionStatus, { label: string; cls: string }> = {
  trial: { label: "Trial", cls: "bg-accent/10 text-accent" },
  active: { label: "Active", cls: "bg-primary-50 text-primary-700" },
  expired: { label: "Hết hạn", cls: "bg-danger-bg text-danger" },
  suspended: { label: "Tạm khóa", cls: "bg-bg-subtle text-ink-muted" },
  cancelled: { label: "Hủy", cls: "bg-bg-subtle text-ink-subtle" },
};

const PAYMENT_PERIODS = [
  { months: 1, label: "1 tháng" },
  { months: 3, label: "3 tháng" },
  { months: 6, label: "6 tháng" },
  { months: 12, label: "12 tháng" },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

interface SubscriptionRow {
  id: string;
  org_id: string;
  tier: string;
  status: SubscriptionStatus;
  monthly_price: number;
  trial_until_date: string | null;
  paid_until_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface PaymentRow {
  id: string;
  amount: number;
  payment_date: string;
  period_months: number;
  payment_method: string;
  notes: string | null;
  created_at: string;
}

export function AdminShopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [shop, setShop] = useState<ShopWithStats | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [payments, setPayments] = useState<SubscriptionPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [trialDate, setTrialDate] = useState("");

  async function reload() {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [shopList, subRows] = await Promise.all([
        api.rpc<ShopWithStats[]>("admin_list_shops"),
        api.list<SubscriptionRow>("subscriptions", { org_id: id }),
      ]);
      const subRow = subRows[0] ?? null;
      const found = (shopList ?? []).find(
        (s) => s.org_id === id,
      );
      if (!found) {
        setError("Không tìm thấy tiệm");
        return;
      }
      setShop(found);
      if (subRow) {
        const sr = subRow as SubscriptionRow;
        setSubscription({
          id: sr.id,
          orgId: sr.org_id,
          tier: sr.tier as Subscription["tier"],
          status: sr.status,
          monthlyPrice: Number(sr.monthly_price),
          trialUntilDate: sr.trial_until_date,
          paidUntilDate: sr.paid_until_date,
          notes: sr.notes,
          createdAt: sr.created_at,
          updatedAt: sr.updated_at,
        });

        // Lịch sử thanh toán đi qua endpoint admin riêng: bảng
        // subscription_payments chỉ lọc được theo subscription_id, còn server
        // join sẵn theo org nên chỉ cần một lời gọi.
        const { data: pays } = await api.get<{ data: PaymentRow[] }>(
          `/admin/shop/${id}/payments`,
        );
        setPayments(
          (pays ?? []).map((p) => ({
            id: p.id,
            subscriptionId: sr.id,
            amount: Number(p.amount),
            paymentDate: p.payment_date,
            periodMonths: p.period_months,
            paymentMethod: p.payment_method as SubscriptionPayment["paymentMethod"],
            recordedBy: null,
            notes: p.notes,
            createdAt: p.created_at,
          })),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải shop thất bại");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function recordPayment(months: number) {
    if (!shop || !subscription) return;
    const amount = subscription.monthlyPrice * months;
    if (!confirm(`Ghi nhận ${formatVND(amount)}đ cho ${months} tháng?`)) return;
    setActionPending(`pay-${months}`);
    try {
      await api.rpc("record_payment", {
        p_org_id: shop.org_id,
        p_amount: amount,
        p_period_months: months,
        p_method: "bank_transfer",
        p_notes: null,
      });
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Ghi nhận thất bại");
    } finally {
      setActionPending(null);
    }
  }

  async function extendTrial() {
    if (!shop || !trialDate) return;
    setActionPending("extend");
    try {
      await api.rpc("extend_trial", {
        p_org_id: shop.org_id,
        p_new_trial_date: trialDate,
      });
      setTrialDate("");
      await reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Kéo dài trial thất bại");
    } finally {
      setActionPending(null);
    }
  }

  async function toggleSuspend() {
    if (!shop || !subscription) return;
    if (subscription.status === "suspended") {
      if (!confirm("Mở khóa shop?")) return;
      setActionPending("unsuspend");
      try {
        await api.rpc("unsuspend_shop", {
          p_org_id: shop.org_id,
        });
          await reload();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Mở khóa thất bại");
      } finally {
        setActionPending(null);
      }
    } else {
      const reason = prompt("Lý do tạm khóa?", "Quá hạn thanh toán");
      if (reason === null) return;
      setActionPending("suspend");
      try {
        await api.rpc("suspend_shop", {
          p_org_id: shop.org_id,
          p_reason: reason || null,
        });
          await reload();
      } catch (err) {
        alert(err instanceof Error ? err.message : "Tạm khóa thất bại");
      } finally {
        setActionPending(null);
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-primary-700" />
      </div>
    );
  }
  if (error || !shop) {
    return (
      <div className="p-6 flex flex-col items-center gap-3">
        <p className="text-sm text-danger">{error ?? "Không tìm thấy"}</p>
        <Button variant="ghost" onClick={() => navigate("/admin/shops")}>
          Quay lại danh sách
        </Button>
      </div>
    );
  }

  const badge = STATUS_LABEL[shop.status];
  const isSuspended = subscription?.status === "suspended";

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg flex items-start gap-3">
        <Link
          to="/admin/shops"
          className="p-2 -ml-2 rounded text-ink-muted hover:bg-bg-subtle press"
          aria-label="Quay lại"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg md:text-xl font-semibold truncate">
              {shop.org_name}
            </h1>
            <span
              className={cn(
                "px-2 py-0.5 rounded text-xs font-medium flex-shrink-0",
                badge.cls,
              )}
            >
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-ink-muted truncate">
            Owner: {shop.owner_email}
          </p>
        </div>
      </div>

      <div className="p-4 md:p-6 space-y-5 max-w-4xl">
        {/* Subscription card */}
        <section className="bg-bg-card border border-line rounded-lg p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-sm font-semibold">Subscription</h2>
              <p className="text-xs text-ink-muted">
                Tier: <span className="font-medium">{subscription?.tier ?? "—"}</span>{" "}
                · {formatVND(subscription?.monthlyPrice ?? 0)}đ/tháng
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-muted">Trial hết hạn</p>
              <p className="font-mono tabular-nums">
                {formatDate(subscription?.trialUntilDate ?? null)}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Đã trả đến</p>
              <p className="font-mono tabular-nums">
                {formatDate(subscription?.paidUntilDate ?? null)}
              </p>
            </div>
          </div>

          {/* Quick payment buttons */}
          <div>
            <p className="text-xs font-medium mb-2">Ghi nhận thanh toán</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {PAYMENT_PERIODS.map((p) => (
                <Button
                  key={p.months}
                  type="button"
                  variant="outline"
                  loading={actionPending === `pay-${p.months}`}
                  disabled={actionPending !== null}
                  onClick={() => recordPayment(p.months)}
                  className="text-sm"
                >
                  +{p.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Extend trial */}
          <div>
            <p className="text-xs font-medium mb-2">Kéo dài trial</p>
            <div className="flex gap-2">
              <input
                type="date"
                value={trialDate}
                onChange={(e) => setTrialDate(e.target.value)}
                className="flex-1 h-touch px-3 rounded-lg border border-line bg-bg-card"
              />
              <Button
                type="button"
                variant="outline"
                loading={actionPending === "extend"}
                disabled={!trialDate || actionPending !== null}
                onClick={extendTrial}
              >
                <Calendar className="w-4 h-4" />
                Áp dụng
              </Button>
            </div>
          </div>

          {/* Suspend toggle */}
          <div className="pt-3 border-t border-line">
            <Button
              type="button"
              variant={isSuspended ? "primary" : "outline"}
              loading={actionPending === "suspend" || actionPending === "unsuspend"}
              disabled={actionPending !== null}
              onClick={toggleSuspend}
              className="w-full"
            >
              {isSuspended ? (
                <>
                  <Play className="w-4 h-4" />
                  Mở khóa shop
                </>
              ) : (
                <>
                  <Pause className="w-4 h-4" />
                  Tạm khóa shop
                </>
              )}
            </Button>
          </div>

          {subscription?.notes && (
            <details className="pt-2">
              <summary className="text-xs font-medium cursor-pointer text-ink-muted">
                Ghi chú subscription
              </summary>
              <pre className="text-xs mt-1 whitespace-pre-wrap text-ink-muted bg-bg p-2 rounded">
                {subscription.notes}
              </pre>
            </details>
          )}
        </section>

        {/* Stats card */}
        <section className="bg-bg-card border border-line rounded-lg p-4">
          <h2 className="text-sm font-semibold mb-3">Thống kê hoạt động</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-ink-muted">Sản phẩm</p>
              <p className="font-mono tabular-nums text-base font-semibold">
                {shop.products_count}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Đơn hàng</p>
              <p className="font-mono tabular-nums text-base font-semibold">
                {shop.orders_count}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Doanh thu</p>
              <p className="font-mono tabular-nums text-base font-semibold text-primary-700">
                {formatVND(shop.total_revenue)}đ
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Đơn cuối</p>
              <p className="text-sm">
                {shop.last_order_at
                  ? new Date(shop.last_order_at).toLocaleDateString("vi-VN")
                  : "—"}
              </p>
            </div>
          </div>
        </section>

        {/* Payments history */}
        {payments.length > 0 && (
          <section className="bg-bg-card border border-line rounded-lg p-4">
            <h2 className="text-sm font-semibold mb-3">
              Lịch sử thanh toán ({payments.length})
            </h2>
            <ul className="divide-y divide-line/60">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="py-2 flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-primary-700 flex-shrink-0" />
                    <div>
                      <p className="font-medium">
                        {p.periodMonths} tháng ·{" "}
                        <span className="text-ink-muted">
                          {p.paymentMethod === "bank_transfer"
                            ? "Chuyển khoản"
                            : p.paymentMethod === "cash"
                              ? "Tiền mặt"
                              : "Khác"}
                        </span>
                      </p>
                      <p className="text-xs text-ink-muted">
                        {formatDate(p.paymentDate)}
                        {p.notes && ` · ${p.notes}`}
                      </p>
                    </div>
                  </div>
                  <p className="font-mono tabular-nums font-semibold text-primary-700">
                    {formatVND(p.amount)}đ
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
