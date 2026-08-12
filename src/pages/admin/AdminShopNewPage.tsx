import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "@/integrations/api";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import {
  AddressAutocomplete,
  type AddressDetail,
} from "@/components/AddressAutocomplete";

const EMAIL_RE = /^\S+@\S+\.\S+$/;

interface CreateResponse {
  org_id: string;
  owner_email: string;
  /** false nghĩa là email đó đã có tài khoản, chỉ gắn thêm quyền owner. */
  owner_created: boolean;
  /**
   * Link để chủ shop tự đặt mật khẩu. Hiện SMTP chưa nối nên server trả thẳng
   * về đây cho admin copy gửi tay. Khi có mail server thì trường này biến mất.
   */
  invite_link: string | null;
}

export function AdminShopNewPage() {
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const adminEmail = useAuthStore((s) => s.user?.email ?? null);
  const isSelfOwner =
    adminEmail !== null &&
    ownerEmail.trim().length > 0 &&
    ownerEmail.trim().toLowerCase() === adminEmail.toLowerCase();
  const [taxCode, setTaxCode] = useState("");
  const [address, setAddress] = useState("");
  const [addressDetail, setAddressDetail] = useState<AddressDetail | null>(null);
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

    // Cảnh báo nếu admin dùng chính email mình → tránh accidental tạo shop
    // mà admin lại trở thành owner (vd. test xong xóa shop thì admin mất quyền).
    const adminEmail = useAuthStore.getState().user?.email;
    if (
      adminEmail &&
      ownerEmail.trim().toLowerCase() === adminEmail.toLowerCase()
    ) {
      const ok = confirm(
        "Email này là tài khoản admin của bạn. Tạo shop với chính bạn làm owner?",
      );
      if (!ok) return;
    }

    setSubmitting(true);
    try {
      // Thay Edge Function admin-create-shop: server tự host làm cả ba việc
      // trong một lời gọi — tạo tiệm + subscription, tạo tài khoản chủ shop
      // nếu chưa có, gắn làm owner. Lỗi ném ra dạng ApiError với message
      // tiếng Việt sẵn nên không phải bóc body thủ công như trước.
      const data = await api.post<CreateResponse>("/admin/create-shop", {
        org_name: orgName.trim(),
        owner_email: ownerEmail.trim(),
        tax_code: taxCode.trim() || undefined,
        address: address.trim() || undefined,
        address_full: addressDetail?.address_full ?? undefined,
        latitude: addressDetail?.latitude ?? undefined,
        longitude: addressDetail?.longitude ?? undefined,
        phone: phone.trim() || undefined,
        trial_days: trialDays,
        monthly_price: monthlyPrice,
      });

      // Chưa nối SMTP: admin phải tự gửi link cho chủ shop. Nói rõ ra thay vì
      // để họ tưởng khách đã nhận được mail.
      if (data.invite_link) {
        window.prompt(
          "Chưa nối email tự động. Copy link này gửi cho chủ shop để họ đặt mật khẩu (hết hạn sau 72 giờ):",
          data.invite_link,
        );
      } else if (!data.owner_created) {
        alert("Email này đã có tài khoản — đã gắn làm chủ tiệm mới.");
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
          {isSelfOwner && !errors.ownerEmail && (
            <p className="-mt-2 text-xs text-accent" role="alert">
              ⚠ Đây là email admin của bạn — tạo shop sẽ tự đặt bạn làm owner.
            </p>
          )}

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

          <FormField
            label="Địa chỉ"
            optional
            hint="Gõ + chọn từ gợi ý để hiển thị shop trên bản đồ"
          >
            <AddressAutocomplete
              value={address}
              onChange={(next, detail) => {
                setAddress(next);
                if (detail) setAddressDetail(detail);
                else setAddressDetail(null);
              }}
              textarea
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
