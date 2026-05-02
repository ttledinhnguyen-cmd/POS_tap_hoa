import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  ChevronDown,
  Package2,
  Pencil,
  Plus,
  Search,
  Tags,
  Trash2,
  Upload,
} from "lucide-react";
import { db } from "@/lib/db";
import { useAuthStore, useCurrentRole } from "@/stores/auth";
import { Button } from "@/components/ui/Button";
import { RoleGate } from "@/components/RoleGate";
import { ProductFormModal } from "@/components/products/ProductFormModal";
import { ProductDeleteConfirm } from "@/components/products/ProductDeleteConfirm";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

// Lazy: CategoryManagerSheet — chỉ owner click "Danh mục sản phẩm" mới load
const CategoryManagerSheet = lazy(() =>
  import("@/components/products/CategoryManagerSheet").then((m) => ({
    default: m.CategoryManagerSheet,
  })),
);

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);

  // Banner "Đã nhập kho thành công" sau redirect từ /inventory/receive
  const justReceived = searchParams.get("received") === "1";
  useEffect(() => {
    if (!justReceived) return;
    const t = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      next.delete("received");
      setSearchParams(next, { replace: true });
    }, 4000);
    return () => window.clearTimeout(t);
  }, [justReceived, searchParams, setSearchParams]);

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
        {/* Action buttons — desktop inline 3 buttons / mobile dropdown menu */}
        <RoleGate allow={["owner"]}>
          {/* Desktop: inline buttons */}
          <div className="hidden md:flex gap-2 flex-wrap justify-end">
            <Button
              variant="outline"
              onClick={() => setShowCategoryManager(true)}
            >
              <Tags className="w-5 h-5" />
              Danh mục
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/inventory/receive")}
            >
              <Package2 className="w-5 h-5" />
              Nhập kho
            </Button>
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
          {/* Mobile: dropdown menu — chật chỗ với 3 buttons */}
          <div className="md:hidden relative">
            <Button
              variant="outline"
              onClick={() => setShowActionsMenu((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={showActionsMenu}
            >
              Quản lý kho
              <ChevronDown className="w-4 h-4" />
            </Button>
            {showActionsMenu && (
              <>
                {/* Backdrop tap-to-close */}
                <button
                  type="button"
                  aria-hidden="true"
                  onClick={() => setShowActionsMenu(false)}
                  className="fixed inset-0 z-30"
                />
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+4px)] z-40 min-w-[200px] bg-bg-card border border-line rounded-lg shadow-soft py-1"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowActionsMenu(false);
                      navigate("/inventory/receive");
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-bg-subtle press"
                  >
                    <Package2 className="w-4 h-4 text-ink-muted" />
                    Nhập kho
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowActionsMenu(false);
                      setShowCategoryManager(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-bg-subtle press"
                  >
                    <Tags className="w-4 h-4 text-ink-muted" />
                    Danh mục sản phẩm
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowActionsMenu(false);
                      setShowBulkImport(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-bg-subtle press"
                  >
                    <Upload className="w-4 h-4 text-ink-muted" />
                    Nhập từ Excel
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowActionsMenu(false);
                      setShowAdd(true);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left hover:bg-bg-subtle press"
                  >
                    <Plus className="w-4 h-4 text-ink-muted" />
                    Thêm sản phẩm
                  </button>
                </div>
              </>
            )}
          </div>
        </RoleGate>
      </div>

      {/* Banner sau khi nhập kho */}
      {justReceived && (
        <div className="px-4 md:px-6 py-2 bg-primary-50 border-b border-primary-100 flex items-center gap-2 text-sm text-primary-800">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>Đã nhập kho thành công. Tồn kho đã được cập nhật.</span>
        </div>
      )}

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
      {/* Category manager — lazy chunk */}
      {showCategoryManager && (
        <Suspense fallback={null}>
          <CategoryManagerSheet
            open={showCategoryManager}
            onClose={() => setShowCategoryManager(false)}
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
