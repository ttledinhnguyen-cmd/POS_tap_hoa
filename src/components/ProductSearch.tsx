import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useCart } from "@/stores/cart";
import { formatVND } from "@/lib/format";
import { beep, vibrate } from "@/lib/utils";

interface Props {
  onClose: () => void;
}

export function ProductSearch({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const addProduct = useCart((s) => s.addProduct);

  // Debounce nhẹ
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [query]);

  const results = useLiveQuery(async () => {
    if (!debounced) {
      return db.products.orderBy("name").limit(20).toArray();
    }
    const all = await db.products.toArray();
    return all
      .filter(
        (p) =>
          p.name.toLowerCase().includes(debounced) ||
          p.barcode.includes(debounced),
      )
      .slice(0, 30);
  }, [debounced]);

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
            placeholder="Tìm tên hoặc nhập mã vạch…"
            className="w-full h-touch pl-11 pr-4 rounded-lg border border-line bg-bg-card focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {results?.length === 0 && (
          <li className="p-8 text-center text-ink-muted">
            Không tìm thấy sản phẩm nào
          </li>
        )}
        {results?.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => {
                addProduct(p);
                beep(660, 60);
                vibrate(20);
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-subtle press text-left border-b border-line/60"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-ink truncate">{p.name}</p>
                <p className="text-xs text-ink-muted font-mono">
                  {p.barcode} · còn {p.stock} {p.unit}
                </p>
              </div>
              <p className="font-mono font-semibold tabular-nums">
                {formatVND(p.priceSell)}đ
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
