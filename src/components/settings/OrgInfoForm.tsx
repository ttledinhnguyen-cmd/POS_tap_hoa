import { type FormEvent, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { FormField } from "@/components/ui/FormField";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/integrations/supabase";
import { useAuthStore, useCurrentOrg } from "@/stores/auth";
import { vibrate } from "@/lib/utils";

const TAX_CODE_RE = /^\d{10}$|^\d{13}$/;
const PHONE_RE = /^0\d{9,10}$/;
const SAVED_TOAST_MS = 2500;

/**
 * OrgInfoForm — owner edit thông tin tiệm hiện tại.
 * Submit: supabase.from('organizations').update.eq('id', orgId)
 * Sau success: loadMemberships() refresh currentOrg trong store → header/sidebar update.
 */
export function OrgInfoForm() {
  const orgId = useAuthStore((s) => s.currentOrgId);
  const currentOrg = useCurrentOrg();
  const loadMemberships = useAuthStore((s) => s.loadMemberships);

  const [name, setName] = useState("");
  const [taxCode, setTaxCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string>();

  // Hydrate fields từ currentOrg khi store load xong / org đổi
  useEffect(() => {
    if (!currentOrg) return;
    setName(currentOrg.name ?? "");
    setTaxCode(currentOrg.tax_code ?? "");
    setAddress(currentOrg.address ?? "");
    setPhone(currentOrg.phone ?? "");
    setErrors({});
    setSavedAt(null);
    setSubmitError(undefined);
  }, [currentOrg?.id, currentOrg?.updated_at]);

  // Auto-clear saved toast
  useEffect(() => {
    if (savedAt === null) return;
    const id = setTimeout(() => setSavedAt(null), SAVED_TOAST_MS);
    return () => clearTimeout(id);
  }, [savedAt]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return;

    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Tên tiệm không được để trống";
    if (taxCode.trim()) {
      const stripped = taxCode.replace(/[\s-]/g, "");
      if (!TAX_CODE_RE.test(stripped)) {
        next.taxCode = "MST phải là 10 hoặc 13 chữ số";
      }
    }
    if (phone.trim() && !PHONE_RE.test(phone.replace(/[\s-]/g, ""))) {
      next.phone = "Số điện thoại không hợp lệ (vd. 0901234567)";
    }
    setErrors(next);
    setSubmitError(undefined);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    const payload = {
      name: name.trim(),
      tax_code: taxCode.trim() ? taxCode.replace(/[\s-]/g, "") : null,
      address: address.trim() || null,
      phone: phone.trim() ? phone.replace(/[\s-]/g, "") : null,
    };
    const { error } = await supabase
      .from("organizations")
      .update(payload)
      .eq("id", orgId);
    setSubmitting(false);

    if (error) {
      setSubmitError(error.message);
      vibrate(15);
      return;
    }
    // Refresh memberships → currentOrg tự cập nhật trong UserBlock + POSPage header
    await loadMemberships();
    vibrate(15);
    setSavedAt(Date.now());
  };

  if (!currentOrg) {
    return <p className="text-sm text-ink-muted">Đang tải thông tin tiệm...</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <FormField label="Tên tiệm" error={errors.name}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tiệm Tạp Hóa Cô Ba"
        />
      </FormField>

      <FormField
        label="Mã số thuế"
        optional
        hint="10 hoặc 13 chữ số"
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

      <FormField label="Số điện thoại" optional error={errors.phone}>
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

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          loading={submitting}
          className="flex-shrink-0"
        >
          {submitting ? "Đang lưu..." : "Lưu thay đổi"}
        </Button>
        {savedAt !== null && (
          <span
            className="flex items-center gap-1 text-sm text-primary-700"
            role="status"
          >
            <Check className="w-4 h-4" />
            Đã lưu
          </span>
        )}
      </div>
    </form>
  );
}
