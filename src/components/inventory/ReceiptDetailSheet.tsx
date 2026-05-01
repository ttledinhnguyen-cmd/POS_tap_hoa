import { useEffect, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { inventorySync } from "@/integrations/sync/inventory-sync";
import { formatVND } from "@/lib/format";
import type { GoodsReceipt, GoodsReceiptItem } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  receipt: GoodsReceipt | null;
}

/**
 * Format ngày YYYY-MM-DD → "DD/MM/YYYY".
 */
function formatDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Format epoch ms → "DD/MM/YYYY HH:mm" (giờ tạo phiếu trên server).
 */
function formatCreatedAt(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Detail 1 phiếu nhập kho. Items pull on demand qua `inventorySync.pullReceiptItems`.
 * Items immutable theo design — Dexie cache lifetime = session.
 */
export function ReceiptDetailSheet({ open, onClose, receipt }: Props) {
  const [items, setItems] = useState<GoodsReceiptItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !receipt) {
      setItems(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    inventorySync
      .pullReceiptItems(receipt.id)
      .then((rows) => {
        if (cancelled) return;
        setItems(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Tải chi tiết thất bại");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, receipt]);

  if (!receipt) return null;
  const idShort = receipt.id.slice(-6).toUpperCase();
  const itemCount = items?.length ?? 0;

  return (
    <Sheet open={open} onClose={onClose} title={`Phiếu nhập #${idShort}`}>
      <div className="px-5 pb-5 flex flex-col gap-4">
        {/* Meta */}
        <div className="space-y-1 text-sm">
          <p className="text-ink-muted">
            Ngày nhập:{" "}
            <span className="text-ink font-medium">
              {formatDate(receipt.receiptDate)}
            </span>
          </p>
          <p className="text-[11px] text-ink-subtle">
            Tạo lúc {formatCreatedAt(receipt.createdAt)}
          </p>
        </div>

        {/* Supplier info */}
        {(receipt.supplierName ||
          receipt.supplierPhone ||
          receipt.supplierTaxCode ||
          receipt.invoiceNo ||
          receipt.notes) && (
          <div className="bg-bg rounded-lg p-3 space-y-1 text-sm">
            {receipt.supplierName && (
              <p>
                <span className="text-ink-muted">Nhà cung cấp:</span>{" "}
                <span className="font-medium">{receipt.supplierName}</span>
              </p>
            )}
            {receipt.supplierPhone && (
              <p>
                <span className="text-ink-muted">SĐT:</span>{" "}
                <span className="font-mono">{receipt.supplierPhone}</span>
              </p>
            )}
            {receipt.supplierTaxCode && (
              <p>
                <span className="text-ink-muted">MST:</span>{" "}
                <span className="font-mono">{receipt.supplierTaxCode}</span>
              </p>
            )}
            {receipt.invoiceNo && (
              <p>
                <span className="text-ink-muted">Số HĐ NCC:</span>{" "}
                <span className="font-mono">{receipt.invoiceNo}</span>
              </p>
            )}
            {receipt.notes && (
              <p>
                <span className="text-ink-muted">Ghi chú:</span>{" "}
                <span>{receipt.notes}</span>
              </p>
            )}
          </div>
        )}

        {/* Items list */}
        <div>
          <p className="text-xs font-semibold text-ink-muted uppercase mb-2">
            Chi tiết
          </p>
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary-700" />
            </div>
          )}
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && items && items.length === 0 && (
            <p className="text-sm text-ink-muted py-4 text-center">
              Phiếu này không có item nào.
            </p>
          )}
          {!loading && items && items.length > 0 && (
            <ul className="border border-line rounded-lg divide-y divide-line/60 overflow-hidden">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-start gap-3 px-3 py-2.5 text-sm"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{it.productName}</p>
                    <p className="text-xs text-ink-muted font-mono tabular-nums">
                      {it.quantity} {it.unit} × {formatVND(it.priceBuy)}đ
                    </p>
                  </div>
                  <p className="font-mono tabular-nums font-semibold flex-shrink-0">
                    {formatVND(it.lineTotal)}đ
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Total */}
        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <div>
            <p className="text-xs text-ink-muted">{itemCount} mặt hàng</p>
            <p className="text-sm">Tổng tiền nhập</p>
          </div>
          <p className="text-xl font-mono tabular-nums font-semibold text-primary-700">
            {formatVND(receipt.totalCost)}đ
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled
            title="Cần kết nối máy in (Sprint 5)"
            className="flex-1"
          >
            <Printer className="w-4 h-4" />
            In phiếu nhập
          </Button>
          <Button type="button" variant="primary" onClick={onClose} className="flex-1">
            Đóng
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
