import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { productsSync } from "@/integrations/sync/products-sync";
import { outboxWorker } from "@/integrations/sync/outbox-worker";
import { useAuthStore } from "@/stores/auth";
import { vibrate } from "@/lib/utils";
import type { Product } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  product: Product | null;
}

/**
 * ProductDeleteConfirm — soft delete (archive). Đặt UX tránh chữ "xóa" để
 * cashier hiểu là ngừng bán; data vẫn còn để báo cáo lịch sử.
 */
export function ProductDeleteConfirm({ open, onClose, product }: Props) {
  const orgId = useAuthStore((s) => s.currentOrgId);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async () => {
    if (!orgId || !product) return;
    setSubmitting(true);
    try {
      await productsSync.archiveProduct(orgId, product.id);
      outboxWorker.drainNow();
      vibrate(15);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Đánh dấu ngừng bán?">
      <div className="px-5 pb-5 flex flex-col gap-4">
        <div className="text-sm text-ink-muted">
          Sản phẩm <span className="font-medium text-ink">{product?.name ?? ""}</span> sẽ
          được ẩn khỏi danh sách bán hàng, nhưng dữ liệu cũ vẫn còn để báo cáo.
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            className="flex-1"
          >
            Hủy
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={submitting}
            onClick={handleConfirm}
            className="flex-1"
          >
            Ngừng bán
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
