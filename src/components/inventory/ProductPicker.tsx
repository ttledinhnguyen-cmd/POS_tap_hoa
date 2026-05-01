import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useAuthStore } from "@/stores/auth";
import { formatVND } from "@/lib/format";
import { beep, vibrate } from "@/lib/utils";
import type { Product } from "@/types";

interface Props {
  onPick: (product: Product) => void;
  onClose: () => void;
}

/**
 * Variant của ProductSearch (POS) cho receive flow — thay vì add to cart,
 * gọi callback onPick(product). Filter products của org hiện tại + isActive.
 */
export function ProductPicker({ onPick, onClose }: Props) {
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [query]);

  const results = useLiveQuery(async () => {
    if (!orgId) return [];
    const all = await db.products.where({ orgId }).toArray();
    const active = all.filter((p) => p.isActive);
    if (!debounced) return active.slice(0, 30);
    return active
      .filter(
        (p) =>
          p.name.toLowerCase().includes(debounced) ||
          p.barcode.includes(debounced),
      )
      .slice(0, 30);
  }, [debounced, orgId]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-line">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-ink-subtle" />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm tên hoặc mã vạch…"
            className="w-full h-touch pl-11 pr-4 rounded-lg border border-line bg-bg-card focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {results?.length === 0 && (
          <li className="p-8 text-center text-ink-muted text-sm">
            Không tìm thấy sản phẩm
          </li>
        )}
        {results?.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => {
                onPick(p);
                beep(660, 60);
                vibrate(20);
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-subtle press text-left border-b border-line/60"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-ink truncate">{p.name}</p>
                <p className="text-xs text-ink-muted font-mono">
                  {p.barcode || "—"} · còn {p.stock} {p.unit}
                </p>
              </div>
              <p className="font-mono font-semibold tabular-nums text-sm">
                {formatVND(p.priceCost)}đ
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
