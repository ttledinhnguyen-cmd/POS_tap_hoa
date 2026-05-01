import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

interface CreateResponse {
  org_id: string;
  owner_user_id: string;
  invite_sent: boolean;
  message?: string;
  error?: string;
}

export function AdminShopNewPage() {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [trialDays, setTrialDays] = useState(30);
  const [monthlyPrice, setMonthlyPrice] = useState(199000);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!orgName.trim()) next.orgName = "Vui lòng nhập tên tiệm";
    if (!ownerEmail.trim() || !EMAIL_RE.test(ownerEmail.trim()))
      next.ownerEmail = "Email không hợp lệ";
    if (trialDays < 0 || trialDays > 365)
      next.trialDays = "Trial từ 0 đến 365 ngày";
    if (monthlyPrice < 0) next.monthlyPrice = "Giá phải >= 0";
    setErrors(next);
    setSubmitError(null);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke<
        CreateResponse
      >("admin-create-shop", {
        body: {
          org_name: orgName.trim(),
          owner_email: ownerEmail.trim(),
          tax_code: taxCode.trim() || undefined,
          address: address.trim() || undefined,
          phone: phone.trim() || undefined,
          trial_days: trialDays,
          monthly_price: monthlyPrice,
        },
      });
      if (invokeErr) throw invokeErr;
      if (!data || data.error) {
        throw new Error(data?.error ?? "Tạo shop thất bại");
      }
      navigate(`/admin/shops/${data.org_id}`, { replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Tạo shop thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-4 md:px-6 py-4 border-b border-line bg-bg-card md:bg-bg flex items-start gap-3">
        <Link
          to="/admin/shops"
          className="p-2 -ml-2 rounded text-ink-muted hover:bg-bg-subtle press"
          aria-label="Quay lại"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-lg md:text-xl font-semibold">Tạo shop mới</h1>
          <p className="text-xs text-ink-muted">
            Owner sẽ nhận email mời + link đặt mật khẩu
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-4 md:p-6 max-w-2xl space-y-5"
        noValidate
      >
        <section className="bg-bg-card border border-line rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold">Thông tin tiệm</h2>
          <FormField label="Tên tiệm" error={errors.orgName}>
            <input
              type="text"
              autoFocus
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Tiệm Tạp Hóa Cô Ba"
            />
          </FormField>

          <FormField
            label="Email owner"
            hint="Email người chủ tiệm — sẽ nhận mời tạo tài khoản"
            error={errors.ownerEmail}
          >
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value.trim())}
              placeholder="owner@example.com"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="MST" optional>
              <input
                type="text"
                inputMode="numeric"
                value={taxCode}
                onChange={(e) => setTaxCode(e.target.value)}
                placeholder="0123456789"
              />
            </FormField>
            <FormField label="SĐT" optional>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0901234567"
              />
            </FormField>
          </div>

          <FormField label="Địa chỉ" optional>
            <textarea
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/TP"
              className="w-full h-auto py-2 px-3 rounded-lg border border-line bg-bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </FormField>
        </section>

        <section className="bg-bg-card border border-line rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold">Subscription</h2>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Trial (ngày)"
              hint="Mặc định 30 ngày"
              error={errors.trialDays}
            >
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="365"
                value={trialDays}
                onChange={(e) => setTrialDays(Number(e.target.value) || 0)}
              />
            </FormField>
            <FormField
              label="Giá / tháng (đ)"
              hint="Mặc định 199.000đ"
              error={errors.monthlyPrice}
            >
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="10000"
                value={monthlyPrice}
                onChange={(e) => setMonthlyPrice(Number(e.target.value) || 0)}
              />
            </FormField>
          </div>
        </section>

        {submitError && (
          <p className="text-sm text-danger" role="alert">
            {submitError}
          </p>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("/admin/shops")}
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
            {submitting ? "Đang tạo..." : "Tạo shop + Gửi invite"}
          </Button>
        </div>
      </form>
    </div>
  );
}
