import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Package2, Plus, Search } from "lucide-react";
import { db } from "@/lib/db";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/Button";
import { RoleGate } from "@/components/RoleGate";
import {
  PERIOD_LABEL,
  PeriodTabs,
  periodRange,
  type Period,
} from "@/components/PeriodTabs";
import { ReceiptDetailSheet } from "@/components/inventory/ReceiptDetailSheet";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GoodsReceipt } from "@/types";

/**
 * Format ngày YYYY-MM-DD → display.
 *   - Hôm nay: HH:mm (đọc giờ tạo phiếu)
 *   - Khác: DD/MM
 */
function formatReceiptDate(receipt: GoodsReceipt): string {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (receipt.receiptDate === todayStr) {
    const d = new Date(receipt.createdAt);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const [, m, d] = receipt.receiptDate.split("-");
  return `${d}/${m}`;
}

/**
 * Convert period range (epoch ms) → date string YYYY-MM-DD cho filter receipt_date.
 * Inclusive cả 2 đầu.
 */
function rangeToDateStrings(period: Period): [string, string] {
  const [startMs, endMs] = periodRange(period);
  const toStr = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  return [toStr(startMs), toStr(endMs)];
}

export function InventoryPage() {
  const navigate = useNavigate();
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [period, setPeriod] = useState<Period>("month");
  const [query, setQuery] = useState("");
  const [openReceipt, setOpenReceipt] = useState<GoodsReceipt | null>(null);

  const [startDate, endDate] = useMemo(() => rangeToDateStrings(period), [period]);

  const receipts = useLiveQuery(
    async () => {
      if (!orgId) return [];
      // Filter qua composite index [orgId+receiptDate], range inclusive.
      const list = await db.goodsReceipts
        .where("[orgId+receiptDate]")
        .between([orgId, startDate], [orgId, endDate], true, true)
        .toArray();
      // Sort desc theo (receiptDate, createdAt) để nhiều phiếu cùng ngày
      // hiển thị đúng thứ tự nhập.
      return list.sort((a, b) => {
        if (a.receiptDate !== b.receiptDate) {
          return a.receiptDate < b.receiptDate ? 1 : -1;
        }
        return b.createdAt - a.createdAt;
      });
    },
    [orgId, startDate, endDate],
    [],
  );

  // Items count cho mỗi receipt — pull from Dexie cache (nếu có; không pull
  // server tự động vì items là on-demand). Hiển thị "—" nếu chưa có cache.
  const itemCounts = useLiveQuery(
    async () => {
      if (receipts.length === 0) return new Map<string, number>();
      const ids = receipts.map((r) => r.id);
      const items = await db.goodsReceiptItems
        .where("receiptId")
        .anyOf(ids)
        .toArray();
      const map = new Map<string, number>();
      for (const it of items) {
        map.set(it.receiptId, (map.get(it.receiptId) ?? 0) + 1);
      }
      return map;
    },
    [receipts],
    new Map(),
  );

  // Search filter — supplier_name (case-insensitive)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return receipts;
    return receipts.filter((r) =>
      (r.supplierName ?? "").toLowerCase().includes(q),
    );
  }, [receipts, query]);

  // Footer totals
  const totalCost = filtered.reduce((sum, r) => sum + r.totalCost, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg">
        <div>
          <h1 className="text-lg md:text-xl font-semibold">Kho hàng</h1>
          <p className="text-xs text-ink-muted">Lịch sử phiếu nhập kho</p>
        </div>
        <RoleGate allow={["owner"]}>
          <Button
            variant="primary"
            onClick={() => navigate("/inventory/receive")}
          >
            <Plus className="w-5 h-5" />
            <span className="hidden md:inline">Nhập phiếu mới</span>
            <span className="md:hidden">Nhập</span>
          </Button>
        </RoleGate>
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
            placeholder="Tìm theo tên nhà cung cấp..."
            className="w-full pl-9 pr-3 h-touch rounded-lg border border-line bg-bg-card focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3 pb-32 md:pb-20">
        {receipts.length === 0 ? (
          <div className="text-center py-12 px-4">
            <Package2 className="w-10 h-10 text-ink-subtle mx-auto mb-2" />
            <p className="text-sm text-ink-muted">
              {PERIOD_LABEL[period]} chưa có phiếu nhập kho.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-ink-muted py-12 text-sm">
            Không tìm thấy phiếu khớp "{query}".
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((r) => {
              const count = itemCounts.get(r.id);
              return (
                <li
                  key={r.id}
                  onClick={() => setOpenReceipt(r)}
                  className={cn(
                    "bg-bg-card border border-line rounded-lg p-3 press cursor-pointer",
                    "hover:border-line-strong",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono tabular-nums text-ink-subtle">
                          #{r.id.slice(-6).toUpperCase()}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {formatReceiptDate(r)}
                        </span>
                        {r.invoiceNo && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-subtle text-ink-muted font-mono">
                            HĐ {r.invoiceNo}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium truncate">
                        {r.supplierName || (
                          <span className="text-ink-subtle font-normal">
                            (không ghi NCC)
                          </span>
                        )}
                      </p>
                      {count !== undefined && (
                        <p className="text-xs text-ink-muted">
                          {count} mặt hàng
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-base font-mono tabular-nums font-semibold text-primary-700">
                        {formatVND(r.totalCost)}đ
                      </p>
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
              {filtered.length} phiếu ·{" "}
              {query ? `khớp "${query}"` : PERIOD_LABEL[period]}
            </span>
            <span className="font-mono tabular-nums font-semibold text-primary-700">
              {formatVND(totalCost)}đ
            </span>
          </div>
        </div>
      )}

      <ReceiptDetailSheet
        open={openReceipt !== null}
        onClose={() => setOpenReceipt(null)}
        receipt={openReceipt}
      />
    </div>
  );
}
