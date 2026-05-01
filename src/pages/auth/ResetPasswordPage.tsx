import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/integrations/supabase";
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

  const updatePassword = useAuthStore((s) => s.updatePassword);

  // Supabase client (detectSessionInUrl=true) tự parse hash khi mount.
  // Đợi 1 tick rồi check session để biết có token hợp lệ không.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      // Đợi auth state event (PASSWORD_RECOVERY) hoặc check session trực tiếp
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) {
        setLoadState("valid");
      } else {
        setLoadState("invalid");
      }
    }
    check();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setLoadState("valid");
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
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

    setLoading(true);
    const { error } = await updatePassword(password);
    setLoading(false);
    vibrate(15);

    if (error) {
      setSubmitError(error);
      return;
    }
    // Sign out để ép user login lại với password mới
    // (gọi supabase trực tiếp, không qua store, vì store SIGNED_OUT sẽ navigate
    // qua AuthGuard — nhưng ta muốn redirect specific URL với query param)
    await supabase.auth.signOut();
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
