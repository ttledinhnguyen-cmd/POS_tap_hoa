import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth";
import { vibrate } from "@/lib/utils";

type LoadState = "checking" | "valid" | "invalid";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>("checking");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{
    password?: string;
    confirm?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const resetPasswordWithToken = useAuthStore((s) => s.resetPasswordWithToken);
  const [token, setToken] = useState<string | null>(null);

  // Backend tự host gửi token đặt lại qua query string (?token=...), khác
  // Supabase vốn nhét session vào hash và tự parse. Ở đây chỉ cần đọc query;
  // token đúng hay sai thì server phán khi bấm gửi — không lộ trước cho kẻ dò.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
    setLoadState(t ? "valid" : "invalid");
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!password) next.password = "Vui lòng nhập mật khẩu mới";
    else if (password.length < 6)
      next.password = "Mật khẩu phải có ít nhất 6 ký tự";
    if (confirm !== password) next.confirm = "Mật khẩu xác nhận không khớp";
    setErrors(next);
    setSubmitError(undefined);
    if (Object.keys(next).length > 0) return;

    if (!token) {
      setSubmitError("Link không hợp lệ hoặc đã hết hạn");
      return;
    }

    setLoading(true);
    const { error } = await resetPasswordWithToken(token, password);
    setLoading(false);
    vibrate(15);

    if (error) {
      setSubmitError(error);
      return;
    }
    // Đặt lại xong thì chưa có phiên nào — server đã thu hồi hết. Đưa thẳng về
    // màn đăng nhập kèm cờ để hiện thông báo thành công.
    navigate("/login?reset=success", { replace: true });
  };

  if (loadState === "checking") {
    return (
      <AuthLayout title="Đặt lại mật khẩu">
        <div className="flex justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-primary-700" />
        </div>
      </AuthLayout>
    );
  }

  if (loadState === "invalid") {
    return (
      <AuthLayout
        title="Link không hợp lệ"
        subtitle="Link đặt lại mật khẩu đã hết hạn hoặc đã được dùng"
        footer={
          <Link to="/forgot-password" className="text-primary-700 font-medium hover:underline">
            Yêu cầu link mới
          </Link>
        }
      >
        <p className="text-sm text-ink-muted">
          Vui lòng quay lại trang quên mật khẩu để gửi yêu cầu mới.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Đặt lại mật khẩu" subtitle="Nhập mật khẩu mới của bạn">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <FormField
          label="Mật khẩu mới"
          hint="Ít nhất 6 ký tự"
          error={errors.password}
        >
          <input
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
          />
        </FormField>

        <FormField label="Xác nhận mật khẩu" error={errors.confirm}>
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

        <Button
          type="submit"
          variant="primary"
          loading={loading}
          className="w-full mt-2"
        >
          {loading ? "Đang lưu..." : "Đặt mật khẩu mới"}
        </Button>
      </form>
    </AuthLayout>
  );
}
