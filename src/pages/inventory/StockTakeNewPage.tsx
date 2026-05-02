import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ClipboardCheck } from "lucide-react";
import { useAuthStore, useCurrentRole } from "@/stores/auth";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { stockTakeSync } from "@/integrations/sync/stock-take-sync";

export function StockTakeNewPage() {
  const navigate = useNavigate();
  const orgId = useAuthStore((s) => s.currentOrgId);
  const role = useCurrentRole();
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cashier không được kiểm kê
  if (role && role !== "owner") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center gap-3">
        <ClipboardCheck className="w-12 h-12 text-ink-subtle" />
        <p className="text-base font-medium">Chỉ chủ shop được kiểm kê</p>
        <Button variant="primary" onClick={() => navigate("/inventory")}>
          Quay về Kho hàng
        </Button>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setSubmitting(true);
    setError(null);
    try {
      const id = await stockTakeSync.createStockTake(orgId, notes || undefined);
      navigate(`/inventory/stock-take/${id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tạo phiếu thất bại");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg flex items-start gap-3">
        <Link
          to="/inventory"
          className="p-2 -ml-2 rounded text-ink-muted hover:bg-bg-subtle press"
          aria-label="Quay lại"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-lg md:text-xl font-semibold">Kiểm kê mới</h1>
          <p className="text-xs text-ink-muted">
            Đếm thực tế tồn kho — sau khi hoàn tất sẽ cập nhật stock theo số đếm
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-4 md:p-6 max-w-xl space-y-4"
        noValidate
      >
        <FormField
          label="Ghi chú"
          optional
          hint="VD. Kiểm kê cuối tháng, trước khi nhập hàng Tết..."
        >
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Lý do, người đếm, khu vực..."
            className="w-full h-auto py-2 px-3 rounded-lg border border-line bg-bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </FormField>

        <div className="bg-bg rounded-lg p-3 text-xs text-ink-muted">
          <p className="font-medium text-ink mb-1">Cách hoạt động:</p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>Tạo phiếu → bạn đứng đếm hàng</li>
            <li>Quét hoặc tìm sản phẩm → nhập số đếm thực tế</li>
            <li>Hệ thống so với tồn dự kiến → tính chênh lệch</li>
            <li>"Hoàn tất" → tồn kho được cập nhật theo số đếm (KHÔNG hoàn tác)</li>
          </ol>
        </div>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("/inventory")}
            disabled={submitting}
            className="flex-1"
          >
            Hủy
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            className="flex-1"
          >
            Bắt đầu kiểm kê
          </Button>
        </div>
      </form>
    </div>
  );
}
