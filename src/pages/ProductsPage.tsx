import { lazy, Suspense, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { useAuthStore, useCurrentRole } from "@/stores/auth";
import { Button } from "@/components/ui/Button";
import { RoleGate } from "@/components/RoleGate";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import { ProductDeleteConfirm } from "@/components/products/ProductDeleteConfirm";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

// Lazy: BulkImportSheet kéo theo SheetJS (~100 KB gzip).
// Chỉ load khi owner click "Nhập từ Excel" — initial bundle không bị bloat.
const BulkImportSheet = lazy(() =>
  import("@/components/products/BulkImportSheet").then((m) => ({
    default: m.BulkImportSheet,
  })),
);

/**
 * Bỏ dấu tiếng Việt + lowercase để search lenient.
 */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();
}

export function ProductsPage() {
  const orgId = useAuthStore((s) => s.currentOrgId);
  const role = useCurrentRole();
  const isOwner = role === "owner";

  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [showBulkImport, setShowBulkImport] = useState(false);

  // Live query Dexie products active của org hiện tại, sort name
  const products = useLiveQuery(
    async () => {
      if (!orgId) return [];
      const list = await db.products.where({ orgId }).toArray();
      return list.filter((p) => p.isActive).sort((a, b) => a.name.localeCompare(b.name, "vi"));
    },
    [orgId],
    [],
  );

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return products;
    return products.filter((p) => {
      return (
        normalize(p.name).includes(q) ||
        (p.barcode && p.barcode.includes(q)) ||
        (p.category && normalize(p.category).includes(q))
      );
    });
  }, [products, query]);

  const empty = products.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg">
        <div>
          <h1 className="text-lg md:text-xl font-semibold">Sản phẩm</h1>
          <p className="text-xs text-ink-muted">
            {products.length} mặt hàng đang bán
          </p>
        </div>
        {/* Action buttons — desktop. Mobile dùng FAB ở dưới + import qua menu Settings/Cài đặt sau. */}
        <RoleGate allow={["owner"]}>
          <div className="hidden md:flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowBulkImport(true)}
            >
              <Upload className="w-5 h-5" />
              Nhập từ Excel
            </Button>
            <Button variant="primary" onClick={() => setShowAdd(true)}>
              <Plus className="w-5 h-5" />
              Thêm sản phẩm
            </Button>
          </div>
        </RoleGate>
      </div>

      {/* Search */}
      <div className="px-4 md:px-6 py-3 border-b border-line bg-bg">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm theo tên, mã vạch, danh mục..."
            className="w-full pl-9 pr-3 h-touch rounded-lg border border-line bg-bg-card focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3 pb-24 md:pb-6">
        {empty ? (
          <EmptyState canAdd={isOwner} onAdd={() => setShowAdd(true)} />
        ) : filtered.length === 0 ? (
          <p className="text-center text-ink-muted py-12 text-sm">
            Không tìm thấy sản phẩm khớp "{query}".
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((p) => (
              <ProductRow
                key={p.id}
                product={p}
                isOwner={isOwner}
                onEdit={() => setEditing(p)}
                onDelete={() => setDeleting(p)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Mobile FAB Add — chỉ owner */}
      <RoleGate allow={["owner"]}>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          aria-label="Thêm sản phẩm"
          className={cn(
            "md:hidden fixed bottom-20 right-4 z-30",
            "w-14 h-14 rounded-full bg-primary-700 text-white shadow-soft press",
            "flex items-center justify-center safe-bottom",
          )}
        >
          <Plus className="w-6 h-6" />
        </button>
      </RoleGate>

      {/* Modals */}
      <ProductFormModal
        open={showAdd || editing !== null}
        onClose={() => {
          setShowAdd(false);
          setEditing(null);
        }}
        product={editing}
      />
      <ProductDeleteConfirm
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        product={deleting}
      />
      {/* Bulk import — lazy chunk: SheetJS ~100KB gzip chỉ load khi mở */}
      {showBulkImport && (
        <Suspense fallback={null}>
          <BulkImportSheet
            open={showBulkImport}
            onClose={() => setShowBulkImport(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

interface RowProps {
  product: Product;
  isOwner: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function ProductRow({ product, isOwner, onEdit, onDelete }: RowProps) {
  const click = isOwner ? onEdit : undefined;
  return (
    <li
      onClick={click}
      className={cn(
        "bg-bg-card border border-line rounded-lg p-3 flex items-center gap-3",
        click && "press cursor-pointer hover:border-line-strong",
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{product.name}</p>
        <p className="text-xs text-ink-muted truncate">
          {product.barcode || "Không có mã"} · {product.unit} · Tồn: {product.stock}
        </p>
      </div>
      <div className="flex flex-col items-end flex-shrink-0">
        <p className="text-sm font-semibold font-mono tabular-nums text-primary-700">
          {formatVND(product.priceSell)}đ
        </p>
        <RoleGate allow={["owner"]}>
          <p className="text-[11px] text-ink-subtle font-mono tabular-nums">
            Vốn: {formatVND(product.priceCost)}đ
          </p>
        </RoleGate>
      </div>
      <RoleGate allow={["owner"]}>
        <div className="flex flex-col gap-1 ml-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            aria-label="Sửa"
            className="p-1.5 rounded hover:bg-bg-subtle press"
          >
            <Pencil className="w-4 h-4 text-ink-muted" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Ngừng bán"
            className="p-1.5 rounded hover:bg-danger-bg press"
          >
            <Trash2 className="w-4 h-4 text-danger" />
          </button>
        </div>
      </RoleGate>
    </li>
  );
}

function EmptyState({
  canAdd,
  onAdd,
}: {
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="text-center py-16">
      <p className="text-ink-muted mb-4">Chưa có sản phẩm nào trong tiệm.</p>
      {canAdd && (
        <Button variant="primary" onClick={onAdd}>
          <Plus className="w-5 h-5" />
          Thêm sản phẩm đầu tiên
        </Button>
      )}
    </div>
  );
}
