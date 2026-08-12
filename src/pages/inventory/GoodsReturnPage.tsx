import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Search, X } from "lucide-react";
import { db } from "@/lib/db";
import { api } from "@/integrations/api";
import { productsSync } from "@/integrations/sync/products-sync";
import { useAuthStore, useCurrentRole } from "@/stores/auth";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { formatVND } from "@/lib/format";
import { cn, vibrate } from "@/lib/utils";
import type { Product } from "@/types";

/**
 * Xuất trả nhà cung cấp — hàng cận date, hàng lỗi, hàng bán không chạy.
 *
 * Khác nhập kho ở hai điểm: trừ kho thay vì cộng, và giá trị trả tính theo
 * GIÁ VỐN (tiền đã bỏ ra mua) chứ không phải giá bán. Server tự lấy giá vốn
 * hiện tại của sản phẩm, client không gửi giá lên.
 */

const REASONS: { value: string; label: string }[] = [
  { value: "expired", label: "Hết hạn / cận date" },
  { value: "damaged", label: "Hư hỏng, móp vỡ" },
  { value: "slow_moving", label: "Bán không chạy" },
  { value: "wrong_item", label: "Giao sai hàng" },
  { value: "other", label: "Lý do khác" },
];

interface ReturnLine {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  priceBuy: number;
  currentStock: number;
}

interface SupplierRow {
  id: string;
  name: string;
}

export function GoodsReturnPage() {
  const navigate = useNavigate();
  const orgId = useAuthStore((s) => s.currentOrgId);
  const role = useCurrentRole();

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [reason, setReason] = useState("expired");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!orgId) return;
    api
      .list<SupplierRow>("suppliers", { org_id: orgId })
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
  }, [orgId]);

  const products = useLiveQuery(
    async () => {
      if (!orgId) return [];
      const all = await db.products.where("orgId").equals(orgId).toArray();
      return all.filter((p) => p.isActive);
    },
    [orgId],
    [],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(lines.map((l) => l.productId));
    return products
      .filter(
        (p) =>
          !chosen.has(p.id) &&
          (p.name.toLowerCase().includes(q) || p.barcode.includes(q)),
      )
      .slice(0, 8);
  }, [products, query, lines]);

  function addLine(p: Product) {
    setLines((curr) => [
      ...curr,
      {
        productId: p.id,
        productName: p.name,
        unit: p.unit,
        quantity: 1,
        priceBuy: p.priceCost,
        currentStock: p.stock,
      },
    ]);
    setQuery("");
    vibrate(20);
  }

  const total = useMemo(
    () => lines.reduce((s, l) => s + Math.round(l.priceBuy * l.quantity), 0),
    [lines],
  );

  async function submit() {
    if (!orgId || lines.length === 0) return;
    const valid = lines.filter((l) => l.quantity > 0);
    if (valid.length === 0) {
      setError("Chưa có dòng nào có số lượng");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await api.rpc("create_goods_return", {
        p_return: {
          id: crypto.randomUUID(),
          org_id: orgId,
          supplier_id: supplierId || null,
          return_date: new Date().toISOString().slice(0, 10),
          reason,
          notes: notes.trim() || null,
        },
        p_items: valid.map((l) => ({
          product_id: l.productId,
          product_name: l.productName,
          unit: l.unit,
          quantity: l.quantity,
        })),
      });
      // Kho vừa bị trừ ở server — kéo lại ngay để màn hình sản phẩm không hiện số cũ
      await productsSync.pullProducts(orgId).catch(() => undefined);
      vibrate([60, 40, 60]);
      navigate("/inventory", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xuất trả thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  if (role && role !== "owner") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center gap-3">
        <p className="font-medium">Chỉ chủ tiệm mới xuất trả được hàng.</p>
        <Button variant="primary" onClick={() => navigate("/inventory")}>
          Quay lại
        </Button>
      </div>
    );
  }

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
        <div>
          <h1 className="text-lg font-semibold">Xuất trả nhà cung cấp</h1>
          <p className="text-xs text-ink-muted">Trừ kho và giảm công nợ</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <FormField label="Nhà cung cấp" hint="Bỏ trống nếu không trừ vào công nợ">
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="h-touch px-3 rounded-lg border border-line bg-bg-card w-full"
          >
            <option value="">— Không chọn —</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Lý do trả">
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="h-touch px-3 rounded-lg border border-line bg-bg-card w-full"
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </FormField>

        <div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm sản phẩm cần trả…"
              className="h-touch w-full pl-9 pr-3 rounded-lg border border-line bg-bg-card"
            />
          </div>
          {matches.length > 0 && (
            <ul className="mt-1 border border-line rounded-lg divide-y divide-line overflow-hidden">
              {matches.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => addLine(p)}
                    className="w-full text-left px-3 py-2.5 hover:bg-bg-subtle press"
                  >
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-ink-muted tabular-nums">
                      Tồn {p.stock} {p.unit} · vốn {formatVND(p.priceCost)}đ
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lines.map((l, i) => (
          <div
            key={l.productId}
            className="bg-bg-card border border-line rounded-lg p-3 flex flex-col gap-2"
          >
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{l.productName}</p>
                <p className="text-xs text-ink-muted tabular-nums">
                  Tồn {l.currentStock} <span className="text-ink-subtle">→</span>{" "}
                  <span
                    className={cn(
                      "font-semibold",
                      l.currentStock - l.quantity < 0 && "text-danger",
                    )}
                  >
                    {l.currentStock - l.quantity}
                  </span>{" "}
                  {l.unit}
                </p>
              </div>
              <button
                onClick={() =>
                  setLines((c) => c.filter((x) => x.productId !== l.productId))
                }
                aria-label="Bỏ dòng"
                className="p-1.5 rounded text-ink-muted hover:bg-danger-bg hover:text-danger press"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex-1 flex flex-col gap-1">
                <span className="text-[11px] text-ink-muted">Số lượng trả</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  autoFocus={i === lines.length - 1}
                  value={l.quantity}
                  onChange={(e) =>
                    setLines((c) =>
                      c.map((x) =>
                        x.productId === l.productId
                          ? { ...x, quantity: Number(e.target.value) || 0 }
                          : x,
                      ),
                    )
                  }
                  className="h-touch px-3 rounded-lg border border-line bg-bg-card font-mono tabular-nums"
                />
              </label>
              <p className="text-sm tabular-nums text-ink-muted pb-3">
                {formatVND(Math.round(l.priceBuy * l.quantity))}đ
              </p>
            </div>
          </div>
        ))}

        <FormField label="Ghi chú" optional>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Trả theo phiếu số…"
          />
        </FormField>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="border-t border-line bg-bg-card p-4 flex items-center gap-3">
        <div className="flex-1">
          <p className="text-xs text-ink-muted">Giá trị trả</p>
          <p className="text-xl font-semibold tabular-nums text-primary-700">
            {formatVND(total)}đ
          </p>
        </div>
        <Button
          variant="primary"
          size="lg"
          disabled={submitting || lines.length === 0}
          onClick={submit}
        >
          {submitting ? "Đang lưu…" : "Xác nhận trả"}
        </Button>
      </div>
    </div>
  );
}
