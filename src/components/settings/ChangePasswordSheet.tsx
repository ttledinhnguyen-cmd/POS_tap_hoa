import { type FormEvent, useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth";
import { vibrate } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SUCCESS_AUTOCLOSE_MS = 1500;

/**
 * Đổi mật khẩu.
 *
 * Khác bản Supabase (đăng nhập lại để xác thực rồi mới updateUser): server tự
 * host kiểm tra mật khẩu hiện tại ngay trong cùng lời gọi. Đổi xong server thu
 * hồi TOÀN BỘ refresh token — kể cả phiên đang mở — nên user phải đăng nhập
 * lại. Cố ý: đổi mật khẩu thường là vì nghi bị lộ.
 */
export function ChangePasswordSheet({ open, onClose }: Props) {
  const user = useAuthStore((s) => s.user);
  const changePassword = useAuthStore((s) => s.changePassword);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>();
  const [successAt, setSuccessAt] = useState<number | null>(null);

  // Reset state khi mở/đóng sheet
  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    setErrors({});
    setSubmitError(undefined);
    setSuccessAt(null);
  }, [open]);

  // Auto-close sau success
  useEffect(() => {
    if (successAt === null) return;
    const id = setTimeout(() => {
      onClose();
    }, SUCCESS_AUTOCLOSE_MS);
    return () => clearTimeout(id);
  }, [successAt, onClose]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?.email) return;

    const next_errors: Record<string, string> = {};
    if (!current) next_errors.current = "Vui lòng nhập mật khẩu hiện tại";
    if (!next) next_errors.next = "Vui lòng nhập mật khẩu mới";
    else if (next.length < 6)
      next_errors.next = "Mật khẩu mới phải có ít nhất 6 ký tự";
    if (confirm !== next)
      next_errors.confirm = "Mật khẩu xác nhận không khớp";
    setErrors(next_errors);
    setSubmitError(undefined);
    if (Object.keys(next_errors).length > 0) return;

    setSubmitting(true);
    // Server tự kiểm tra mật khẩu hiện tại trong cùng một lời gọi, không cần
    // đăng nhập lại để xác thực như bản Supabase. Đổi xong server thu hồi mọi
    // refresh token nên store sẽ tự đưa về màn đăng nhập.
    const { error } = await changePassword(current, next);
    setSubmitting(false);
    vibrate(15);

    if (error) {
      if (error.includes("hiện tại")) {
        setErrors({ current: error });
      } else {
        setSubmitError(error);
      }
      return;
    }
    setSuccessAt(Date.now());
  };

  return (
    <Sheet open={open} onClose={onClose} title="Đổi mật khẩu">
      <form onSubmit={handleSubmit} className="px-5 pb-5 flex flex-col gap-4" noValidate>
        {successAt !== null ? (
          <div
            className="rounded-lg bg-primary-50 border border-primary-100 p-3 text-sm text-primary-800"
            role="status"
          >
            Đã đổi mật khẩu. Sheet sẽ tự đóng...
          </div>
        ) : (
          <>
            <FormField label="Mật khẩu hiện tại" error={errors.current}>
              <input
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="••••••"
              />
            </FormField>
            <FormField
              label="Mật khẩu mới"
              hint="Ít nhất 6 ký tự"
              error={errors.next}
            >
              <input
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="••••••"
              />
            </FormField>
            <FormField label="Xác nhận mật khẩu mới" error={errors.confirm}>
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••"
              />
            </FormField>
            {submitError && (
              <p className="text-sm text-danger" role="alert">
                {submitError}
              </p>
            )}
            <div className="flex gap-2 mt-2">
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
                type="submit"
                variant="primary"
                loading={submitting}
                className="flex-1"
              >
                {submitting ? "Đang lưu..." : "Đổi mật khẩu"}
              </Button>
            </div>
          </>
        )}
      </form>
    </Sheet>
  );
}
