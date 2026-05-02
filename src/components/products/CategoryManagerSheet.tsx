import { type FormEvent, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronUp,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { db } from "@/lib/db";
import { useAuthStore } from "@/stores/auth";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { categoriesSync } from "@/integrations/sync/categories-sync";
import { cn } from "@/lib/utils";
import type { Category } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Sheet quản lý danh mục — owner add / rename / reorder / delete.
 * Drag-to-reorder dùng up/down buttons (KHÔNG dùng HTML5 DnD vì mobile touch
 * không reliable).
 */
export function CategoryManagerSheet({ open, onClose }: Props) {
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [newName, setNewName] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);

  // Live categories sort displayOrder
  const categories = useLiveQuery(
    async () => {
      if (!orgId) return [];
      const list = await db.categories.where({ orgId }).toArray();
      return list.sort((a, b) => a.displayOrder - b.displayOrder);
    },
    [orgId],
    [],
  );

  // Count products per category (cho confirm dialog xóa)
  const productCountByCategory = useLiveQuery(
    async () => {
      if (!orgId) return new Map<string, number>();
      const products = await db.products.where({ orgId }).toArray();
      const map = new Map<string, number>();
      for (const p of products) {
        if (p.isActive && p.category?.trim()) {
          map.set(p.category, (map.get(p.category) ?? 0) + 1);
        }
      }
      return map;
    },
    [orgId],
    new Map(),
  );

  useEffect(() => {
    if (!open) {
      setNewName("");
      setCreateError(null);
      setEditingId(null);
      setEditingValue("");
      setPendingId(null);
      setConfirmDelete(null);
    }
  }, [open]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    const name = newName.trim();
    if (!name) {
      setCreateError("Vui lòng nhập tên danh mục");
      return;
    }
    if (categories.some((c) => c.name === name)) {
      setCreateError("Tên đã tồn tại");
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      await categoriesSync.create(orgId, name);
      setNewName("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Tạo thất bại");
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleRename(id: string) {
    const name = editingValue.trim();
    const current = categories.find((c) => c.id === id);
    if (!current) return;
    if (!name || name === current.name) {
      setEditingId(null);
      setEditingValue("");
      return;
    }
    setPendingId(id);
    try {
      await categoriesSync.rename(id, name);
      setEditingId(null);
      setEditingValue("");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Đổi tên thất bại");
    } finally {
      setPendingId(null);
    }
  }

  async function handleMove(id: string, direction: "up" | "down") {
    if (!orgId) return;
    const idx = categories.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= categories.length) return;
    // Swap → build new ordered ids array → reorder RPC
    const newOrder = categories.map((c) => c.id);
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    setPendingId(id);
    try {
      await categoriesSync.reorder(orgId, newOrder);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Sắp xếp thất bại");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(c: Category) {
    setPendingId(c.id);
    try {
      await categoriesSync.delete(c.id);
      setConfirmDelete(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Xóa thất bại");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Quản lý danh mục">
        <div className="flex flex-col max-h-[80vh]">
          {/* Add new section */}
          <form
            onSubmit={handleCreate}
            className="px-5 py-4 border-b border-line bg-bg-card"
          >
            <p className="text-xs font-medium text-ink-muted mb-2">
              Thêm danh mục mới
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setCreateError(null);
                }}
                placeholder="Vd. Đồ uống, Bánh kẹo..."
                disabled={createSubmitting}
                className="flex-1 h-touch px-3 rounded-lg border border-line bg-bg-card focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <Button
                type="submit"
                variant="primary"
                loading={createSubmitting}
                disabled={!newName.trim()}
              >
                <Plus className="w-4 h-4" />
                Thêm
              </Button>
            </div>
            {createError && (
              <p className="text-xs text-danger mt-1" role="alert">
                {createError}
              </p>
            )}
          </form>

          {/* List */}
          <div className="flex-1 overflow-y-auto px-3 py-2">
            {categories.length === 0 ? (
              <p className="text-center text-sm text-ink-muted py-12">
                Chưa có danh mục. Tạo danh mục đầu tiên ở trên.
              </p>
            ) : (
              <ul className="space-y-1">
                {categories.map((c, idx) => {
                  const isEditing = editingId === c.id;
                  const pending = pendingId === c.id;
                  const productCount = productCountByCategory.get(c.name) ?? 0;
                  return (
                    <li
                      key={c.id}
                      className={cn(
                        "flex items-center gap-2 px-2 py-2 rounded-lg",
                        pending ? "opacity-60" : "hover:bg-bg-subtle",
                      )}
                    >
                      <GripVertical className="w-4 h-4 text-ink-subtle flex-shrink-0" />

                      {isEditing ? (
                        <input
                          type="text"
                          value={editingValue}
                          autoFocus
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(c.id);
                            if (e.key === "Escape") {
                              setEditingId(null);
                              setEditingValue("");
                            }
                          }}
                          onBlur={() => handleRename(c.id)}
                          className="flex-1 h-9 px-2 rounded border border-primary-500 bg-bg-card focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(c.id);
                            setEditingValue(c.name);
                          }}
                          className="flex-1 text-left text-sm font-medium truncate min-w-0 press"
                        >
                          {c.name}
                          {productCount > 0 && (
                            <span className="ml-2 text-[11px] text-ink-muted font-normal">
                              ({productCount} sản phẩm)
                            </span>
                          )}
                        </button>
                      )}

                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(c.id);
                              setEditingValue(c.name);
                            }}
                            disabled={pending}
                            aria-label="Sửa tên"
                            className="p-1.5 rounded text-ink-muted hover:bg-line press"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isEditing ? (
                          <button
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleRename(c.id);
                            }}
                            disabled={pending}
                            aria-label="Lưu"
                            className="p-1.5 rounded text-primary-700 hover:bg-primary-50 press"
                          >
                            {pending ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Check className="w-3.5 h-3.5" />
                            )}
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleMove(c.id, "up")}
                              disabled={idx === 0 || pending}
                              aria-label="Lên"
                              className="p-1.5 rounded text-ink-muted hover:bg-line press disabled:opacity-30"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMove(c.id, "down")}
                              disabled={
                                idx === categories.length - 1 || pending
                              }
                              aria-label="Xuống"
                              className="p-1.5 rounded text-ink-muted hover:bg-line press disabled:opacity-30"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDelete(c)}
                              disabled={pending}
                              aria-label="Xóa"
                              className="p-1.5 rounded text-danger hover:bg-danger-bg press"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer close */}
          <div className="px-5 py-3 border-t border-line bg-bg-card safe-bottom">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="w-full"
            >
              Đóng
            </Button>
          </div>
        </div>
      </Sheet>

      {/* Confirm delete dialog */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-bg-card rounded-xl shadow-xl max-w-sm w-full p-5 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-danger" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-base">
                  Xóa danh mục "{confirmDelete.name}"?
                </h3>
                <p className="text-sm text-ink-muted mt-1">
                  {(productCountByCategory.get(confirmDelete.name) ?? 0) > 0
                    ? `${productCountByCategory.get(confirmDelete.name)} sản phẩm sẽ chuyển vào "Khác".`
                    : "Không có sản phẩm nào đang dùng danh mục này."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                aria-label="Đóng"
                className="p-1 -m-1 rounded text-ink-muted hover:text-ink press flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDelete(null)}
                className="flex-1"
              >
                Hủy
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => handleDelete(confirmDelete)}
                loading={pendingId === confirmDelete.id}
                className="flex-1 !bg-danger hover:!bg-danger/90 text-white"
              >
                Xóa
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Avoid unused import warning — ChevronUp dùng cho future feature
void ChevronUp;
