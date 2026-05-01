import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { useAuthStore } from "@/stores/auth";
import { vibrate } from "@/lib/utils";

const TAX_CODE_RE = /^\d{10}$|^\d{13}$/;
const PHONE_RE = /^0\d{9,10}$/;

export function OnboardingPage() {
  const [name, setName] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");

  const [errors, setErrors] = useState<{
    name?: string;
    taxCode?: string;
    phone?: string;
  }>({});
  const [submitError, setSubmitError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const createOrganization = useAuthStore((s) => s.createOrganization);
  const signOut = useAuthStore((s) => s.signOut);
  const memberships = useAuthStore((s) => s.memberships);
  const isFirstOrg = memberships.length === 0;

  /**
   * Validate + submit. `skipOptional`=true thì bỏ qua MST/địa chỉ/phone (gửi null).
   */
  async function submit(skipOptional: boolean) {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Vui lòng nhập tên tiệm";

    if (!skipOptional) {
      if (taxCode.trim()) {
        const stripped = taxCode.replace(/[\s-]/g, "");
        if (!TAX_CODE_RE.test(stripped)) {
          next.taxCode = "MST phải là 10 hoặc 13 chữ số";
        }
      }
      if (phone.trim() && !PHONE_RE.test(phone.replace(/[\s-]/g, ""))) {
        next.phone = "Số điện thoại không hợp lệ (vd. 0901234567)";
      }
    }

    setErrors(next);
    setSubmitError(undefined);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    const { error } = await createOrganization({
      name: name.trim(),
      taxCode: skipOptional ? undefined : taxCode.replace(/[\s-]/g, "") || undefined,
      address: skipOptional ? undefined : address.trim() || undefined,
      phone: skipOptional ? undefined : phone.replace(/[\s-]/g, "") || undefined,
    });
    setLoading(false);
    vibrate(15);

    if (error) {
      setSubmitError(error);
      return;
    }
    // Store đã loadMemberships + set currentOrgId. AuthGuard sẽ render / OK.
    navigate("/", { replace: true });
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(false);
  };

  const handleSkip = () => {
    submit(true);
  };

  // User có thể logout từ onboarding (ví dụ chọn nhầm tài khoản)
  const handleLogout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <AuthLayout
      title={isFirstOrg ? "Tạo tiệm bán hàng đầu tiên" : "Tạo tiệm mới"}
      subtitle={
        isFirstOrg
          ? "Bạn có thể cập nhật thông tin sau ở Cài đặt"
          : "Tạo thêm 1 tiệm vào tài khoản hiện tại"
      }
      footer={
        isFirstOrg ? (
          <button
            type="button"
            onClick={handleLogout}
            className="text-ink-muted hover:underline"
          >
            Đăng nhập tài khoản khác
          </button>
        ) : (
          <button
            type="button"
            onClick={() => navigate("/")}
            className="text-ink-muted hover:underline"
          >
            Hủy, quay về tiệm hiện tại
          </button>
        )
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <FormField label="Tên tiệm" error={errors.name}>
          <input
            type="text"
            autoFocus
            autoComplete="organization"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tiệm Tạp Hóa Cô Ba"
          />
        </FormField>

        <FormField
          label="Mã số thuế"
          optional
          hint="10 hoặc 13 chữ số (chỉ điền nếu hộ KD đã đăng ký)"
          error={errors.taxCode}
        >
          <input
            type="text"
            inputMode="numeric"
            value={taxCode}
            onChange={(e) => setTaxCode(e.target.value)}
            placeholder="0123456789"
          />
        </FormField>

        <FormField label="Địa chỉ" optional>
          <textarea
            rows={2}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Số nhà, đường, phường/xã, quận/huyện"
            className="h-auto py-2 resize-none"
          />
        </FormField>

        <FormField
          label="Số điện thoại"
          optional
          error={errors.phone}
        >
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0901234567"
          />
        </FormField>

        {submitError && (
          <p className="text-sm text-danger" role="alert">
            {submitError}
          </p>
        )}

        <div className="flex flex-col gap-2 mt-2">
          <Button
            type="submit"
            variant="primary"
            loading={loading}
            className="w-full"
          >
            {loading ? "Đang tạo..." : "Tạo tiệm"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleSkip}
            disabled={loading}
            className="w-full"
          >
            Bỏ qua phần không bắt buộc
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
