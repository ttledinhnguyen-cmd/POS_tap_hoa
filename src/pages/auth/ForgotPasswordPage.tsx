import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth";
import { vibrate } from "@/lib/utils";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string>();
  const [submitError, setSubmitError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const resetPassword = useAuthStore((s) => s.resetPassword);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setEmailError(undefined);
    setSubmitError(undefined);
    if (!email || !EMAIL_RE.test(email)) {
      setEmailError("Email không hợp lệ");
      return;
    }
    setLoading(true);
    const { error } = await resetPassword(email);
    setLoading(false);
    vibrate(15);
    if (error) {
      setSubmitError(error);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <AuthLayout
        title="Kiểm tra email"
        subtitle={`Đã gửi link đặt lại mật khẩu tới ${email}`}
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
            Mở email và bấm vào link để đặt mật khẩu mới. Link có hiệu lực
            trong 1 giờ.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Quên mật khẩu"
      subtitle="Nhập email — chúng tôi sẽ gửi link đặt lại"
      footer={
        <Link to="/login" className="text-primary-700 font-medium hover:underline">
          Quay lại đăng nhập
        </Link>
      }
    >
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
          {loading ? "Đang gửi..." : "Gửi link đặt lại"}
        </Button>
      </form>
    </AuthLayout>
  );
}
