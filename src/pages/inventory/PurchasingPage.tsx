import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, PackagePlus, Phone, Wallet } from "lucide-react";
import { api } from "@/integrations/api";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { FormField } from "@/components/ui/FormField";
import { formatVND } from "@/lib/format";
import { cn, vibrate } from "@/lib/utils";

/**
 * Trang mua hàng — hai việc chủ tiệm làm ngay trước khi NVBH ghé:
 * đọc số cần đặt, và biết đang nợ ai bao nhiêu.
 */

type Tab = "reorder" | "debt";

interface ReorderRow {
  product_id: string;
  name: string;
  unit: string;
  category: string | null;
  stock: number;
  sold_total: number;
  sold_per_day: number;
  days_left: number | null;
  suggest_qty: number;
  pack_size: number | null;
  pack_unit: string | null;
  suggest_packs: number | null;
  price_buy: number;
}

interface DebtRow {
  supplier_id: string;
  supplier_name: string;
  phone: string | null;
  total_purchased: number;
  total_paid: number;
  balance: number;
  last_purchase_at: string | null;
  receipts_count: number;
}

// Cửa sổ tính tốc độ bán và số ngày muốn hàng đủ bán.
// 14/7 hợp với nhịp NVBH ghé mỗi tuần: nhìn 2 tuần vừa rồi, đặt đủ cho 1 tuần tới.
const HISTORY_DAYS = 14;
const HORIZON_DAYS = 7;

export function PurchasingPage() {
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [tab, setTab] = useState<Tab>("reorder");

  const [reorder, setReorder] = useState<ReorderRow[] | null>(null);
  const [debt, setDebt] = useState<DebtRow[] | null>(null);
  const [error, setError] = useState<string>();

  const [payTarget, setPayTarget] = useState<DebtRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payNote, setPayNote] = useState("");
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setError(undefined);
    try {
      const [r, d] = await Promise.all([
        api.rpc<ReorderRow[]>("suggest_reorder", {
          p_org_id: orgId,
          p_days: HISTORY_DAYS,
          p_horizon: HORIZON_DAYS,
        }),
        api.rpc<DebtRow[]>("supplier_debt", { p_org_id: orgId }),
      ]);
      setReorder(r ?? []);
      setDebt(d ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải dữ liệu thất bại");
      setReorder([]);
      setDebt([]);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitPayment() {
    if (!payTarget) return;
    const amount = Math.round(Number(payAmount.replace(/[^\d]/g, "")));
    if (!amount || amount <= 0) return;
    setPaying(true);
    try {
      await api.rpc("record_supplier_payment", {
        p_supplier_id: payTarget.supplier_id,
        p_amount: amount,
        p_method: "cash",
        p_notes: payNote.trim() || null,
        p_date: null,
      });
      vibrate(15);
      setPayTarget(null);
      setPayAmount("");
      setPayNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ghi nhận thất bại");
    } finally {
      setPaying(false);
    }
  }

  const loading = reorder === null || debt === null;
  const totalDebt = (debt ?? [])
    .filter((d) => d.balance > 0)
    .reduce((s, d) => s + d.balance, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-4 md:px-6 py-3 border-b border-line bg-bg-card flex items-center gap-3">
        <Link
          to="/inventory"
          className="p-2 -ml-2 rounded text-ink-muted hover:bg-bg-subtle press"
          aria-label="Quay lại"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-semibold">Mua hàng</h1>
      </header>

      <div className="flex border-b border-line bg-bg-card">
        <button
          onClick={() => setTab("reorder")}
          className={cn(
            "flex-1 h-touch text-sm font-medium press",
            tab === "reorder"
              ? "text-primary-700 border-b-2 border-primary-700"
              : "text-ink-muted",
          )}
        >
          Cần đặt
          {reorder && reorder.length > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-xs">
              {reorder.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("debt")}
          className={cn(
            "flex-1 h-touch text-sm font-medium press",
            tab === "debt"
              ? "text-primary-700 border-b-2 border-primary-700"
              : "text-ink-muted",
          )}
        >
          Công nợ
          {totalDebt > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-danger/10 text-danger text-xs tabular-nums">
              {formatVND(totalDebt)}
            </span>
          )}
        </button>
      </div>

      {error && (
        <p className="px-4 py-2 text-sm text-danger bg-danger/5" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-7 h-7 animate-spin text-primary-700" />
        </div>
      ) : tab === "reorder" ? (
        <div className="flex-1 overflow-y-auto">
          {reorder.length === 0 ? (
            <EmptyState
              icon={<PackagePlus className="w-10 h-10" />}
              title="Chưa có gì cần đặt"
              hint={`Dựa trên ${HISTORY_DAYS} ngày bán gần nhất. Bán được vài ngày rồi mở lại, app sẽ tính ra mặt hàng nào sắp hết.`}
            />
          ) : (
            <>
              <p className="px-4 pt-3 pb-1 text-xs text-ink-muted">
                Đủ bán {HORIZON_DAYS} ngày tới, tính theo tốc độ bán{" "}
                {HISTORY_DAYS} ngày qua
              </p>
              <ul className="divide-y divide-line">
                {reorder.map((r) => (
                  <li key={r.product_id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{r.name}</p>
                        <p className="text-xs text-ink-muted mt-0.5 tabular-nums">
                          Còn {r.stock} {r.unit} · bán {r.sold_per_day}/ngày
                          {r.days_left !== null && (
                            <>
                              {" · "}
                              <span
                                className={cn(
                                  r.days_left <= 2 && "text-danger font-medium",
                                )}
                              >
                                hết sau {r.days_left} ngày
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold tabular-nums text-primary-700">
                          {r.suggest_packs !== null
                            ? `${r.suggest_packs} ${r.pack_unit ?? "thùng"}`
                            : `${r.suggest_qty} ${r.unit}`}
                        </p>
                        {r.suggest_packs !== null && (
                          <p className="text-xs text-ink-muted tabular-nums">
                            = {r.suggest_qty} {r.unit}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {debt.length === 0 ? (
            <EmptyState
              icon={<Wallet className="w-10 h-10" />}
              title="Chưa có nhà cung cấp"
              hint="Nhà cung cấp được tạo tự động khi bạn nhập hàng và điền tên NCC."
            />
          ) : (
            <ul className="divide-y divide-line">
              {debt.map((d) => (
                <li key={d.supplier_id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{d.supplier_name}</p>
                      <p className="text-xs text-ink-muted mt-0.5 tabular-nums">
                        {d.receipts_count} phiếu · đã trả{" "}
                        {formatVND(d.total_paid)}đ
                        {d.last_purchase_at && ` · nhập ${d.last_purchase_at}`}
                      </p>
                      {d.phone && (
                        <a
                          href={`tel:${d.phone}`}
                          className="inline-flex items-center gap-1 mt-1 text-xs text-primary-700 press"
                        >
                          <Phone className="w-3.5 h-3.5" />
                          {d.phone}
                        </a>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={cn(
                          "font-semibold tabular-nums",
                          d.balance > 0
                            ? "text-danger"
                            : d.balance < 0
                              ? "text-primary-700"
                              : "text-ink-muted",
                        )}
                      >
                        {formatVND(Math.abs(d.balance))}đ
                      </p>
                      <p className="text-xs text-ink-muted">
                        {d.balance > 0
                          ? "còn nợ"
                          : d.balance < 0
                            ? "trả dư"
                            : "đã xong"}
                      </p>
                      <button
                        onClick={() => {
                          setPayTarget(d);
                          setPayAmount(d.balance > 0 ? String(d.balance) : "");
                        }}
                        className="mt-1.5 px-3 h-9 rounded border border-line text-sm press"
                      >
                        Trả tiền
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Sheet
        open={payTarget !== null}
        onClose={() => setPayTarget(null)}
        title={`Trả tiền ${payTarget?.supplier_name ?? ""}`}
      >
        <div className="px-5 pb-5 flex flex-col gap-4">
          {payTarget && payTarget.balance > 0 && (
            <p className="text-sm text-ink-muted">
              Đang nợ{" "}
              <span className="font-semibold text-danger tabular-nums">
                {formatVND(payTarget.balance)}đ
              </span>
            </p>
          )}
          <FormField label="Số tiền trả">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
          </FormField>
          <FormField label="Ghi chú" optional>
            <input
              type="text"
              value={payNote}
              onChange={(e) => setPayNote(e.target.value)}
              placeholder="Trả đợt 1"
            />
          </FormField>
          <Button
            onClick={submitPayment}
            disabled={paying || !payAmount}
            className="w-full"
          >
            {paying ? "Đang lưu…" : "Ghi nhận"}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-8 py-16 text-ink-muted">
      <div className="mb-3 opacity-40">{icon}</div>
      <p className="font-medium text-ink">{title}</p>
      <p className="text-sm mt-1 max-w-xs">{hint}</p>
    </div>
  );
}
