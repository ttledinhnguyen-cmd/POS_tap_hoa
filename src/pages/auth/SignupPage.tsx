import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth";
import { vibrate } from "@/lib/utils";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function SignupPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    password?: string;
    confirm?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const navigate = useNavigate();
  const signUp = useAuthStore((s) => s.signUp);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!fullName.trim()) next.name = "Vui lòng nhập tên của bạn";
    if (!email || !EMAIL_RE.test(email)) next.email = "Email không hợp lệ";
    if (!password) next.password = "Vui lòng nhập mật khẩu";
    else if (password.length < 6)
      next.password = "Mật khẩu phải có ít nhất 6 ký tự";
    if (confirm !== password) next.confirm = "Mật khẩu xác nhận không khớp";
    setErrors(next);
    setSubmitError(undefined);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    const { error, requiresConfirm } = await signUp(email, password, fullName.trim());
    setLoading(false);
    vibrate(15);

    if (error) {
      setSubmitError(error);
      return;
    }
    if (requiresConfirm) {
      // "Confirm email" đang BẬT trong Supabase Dashboard
      setEmailSent(true);
    } else {
      // "Confirm email" đã TẮT → auto-login, AuthGuard sẽ đẩy sang /onboarding
      navigate("/onboarding", { replace: true });
    }
  };

  // Trạng thái sau khi gửi email confirmation
  if (emailSent) {
    return (
      <AuthLayout
        title="Kiểm tra email"
        subtitle={`Chúng tôi đã gửi link xác minh tới ${email}`}
        footer={
          <Link to="/login" className="text-primary-700 font-medium hover:underline">
            Quay lại đăng nhập
          </Link>
        }
      >
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="w-14 h-14 rounded-full bg-primary-50 flex items-center justify-center">
            <Mail className="w-7 h-7 text-primary-700" />
          </div>
          <p className="text-center text-sm text-ink-muted">
            Mở email và bấm vào link để xác minh tài khoản. Sau đó quay lại đây
            đăng nhập.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Tạo tài khoản"
      subtitle="Bắt đầu bán hàng trong vài phút"
      footer={
        <>
          Đã có tài khoản?{" "}
          <Link to="/login" className="text-primary-700 font-medium hover:underline">
            Đăng nhập
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <FormField label="Họ tên" error={errors.name}>
          <input
            type="text"
            autoComplete="name"
            autoFocus
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Nguyễn Văn A"
          />
        </FormField>

        <FormField label="Email" error={errors.email}>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            placeholder="ban@email.com"
          />
        </FormField>

        <FormField
          label="Mật khẩu"
          hint="Ít nhất 6 ký tự"
          error={errors.password}
        >
          <input
            type="password"
            autoComplete="new-password"
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
          {loading ? "Đang tạo..." : "Đăng ký"}
        </Button>
      </form>
    </AuthLayout>
  );
}
