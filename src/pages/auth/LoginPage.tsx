import { type FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth";
import { vibrate } from "@/lib/utils";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function LoginPage() {
  const [params] = useSearchParams();
  const justReset = params.get("reset") === "success";
  const justSignedUp = params.get("signup") === "success";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [passwordError, setPasswordError] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const signIn = useAuthStore((s) => s.signIn);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setEmailError(undefined);
    setPasswordError(undefined);
    setSubmitError(undefined);

    let ok = true;
    if (!email || !EMAIL_RE.test(email)) {
      setEmailError("Email không hợp lệ");
      ok = false;
    }
    if (!password) {
      setPasswordError("Vui lòng nhập mật khẩu");
      ok = false;
    }
    if (!ok) return;

    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    vibrate(15);

    if (error) {
      setSubmitError(error);
      return;
    }
    // Store onAuthStateChange catch SIGNED_IN → load memberships → status update.
    // AuthGuard sẽ tự kiểm membership và redirect đúng.
    navigate("/", { replace: true });
  };

  return (
    <AuthLayout
      title="Đăng nhập"
      subtitle="Vào phần mềm bán hàng của bạn"
      footer={
        <>
          Chưa có tài khoản?{" "}
          <Link to="/signup" className="text-primary-700 font-medium hover:underline">
            Đăng ký
          </Link>
        </>
      }
    >
      {(justReset || justSignedUp) && (
        <div
          className="mb-4 flex items-start gap-2 rounded-lg bg-primary-50 border border-primary-100 p-3 text-sm text-primary-800"
          role="status"
        >
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-primary-700" />
          <p>
            {justReset
              ? "Đặt lại mật khẩu thành công. Đăng nhập với mật khẩu mới."
              : "Tạo tài khoản thành công. Đăng nhập để tiếp tục."}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <FormField label="Email" error={emailError}>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value.trim())}
            placeholder="ban@email.com"
          />
        </FormField>

        <FormField
          label="Mật khẩu"
          error={passwordError}
          footer={
            <Link
              to="/forgot-password"
              className="text-xs text-primary-700 font-medium hover:underline self-start"
            >
              Quên mật khẩu?
            </Link>
          }
        >
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          {loading ? "Đang đăng nhập..." : "Đăng nhập"}
        </Button>
      </form>
    </AuthLayout>
  );
}
