import { type FormEvent, useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/integrations/supabase";
import { useAuthStore } from "@/stores/auth";
import { vibrate } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SUCCESS_AUTOCLOSE_MS = 1500;

/**
 * ChangePasswordSheet — re-authenticate với mật khẩu hiện tại để verify, rồi
 * updateUser với password mới.
 *
 * Re-auth dùng signInWithPassword: nếu sai → "Mật khẩu hiện tại không đúng";
 * nếu đúng → session refresh + tiến hành updateUser. Side effect SIGNED_IN
 * event trong store đã được handle (loadMemberships chạy lại) — OK.
 */
export function ChangePasswordSheet({ open, onClose }: Props) {
  const user = useAuthStore((s) => s.user);

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
    // 1. Re-auth — verify mật khẩu hiện tại
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: current,
    });
    if (reauthErr) {
      setSubmitting(false);
      setErrors({ current: "Mật khẩu hiện tại không đúng" });
      vibrate(15);
      return;
    }
    // 2. Update password
    const { error: updateErr } = await supabase.auth.updateUser({
      password: next,
    });
    setSubmitting(false);
    vibrate(15);
    if (updateErr) {
      setSubmitError(updateErr.message);
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
