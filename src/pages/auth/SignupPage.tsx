import { Link } from "react-router-dom";
import { Mail } from "lucide-react";
import { AuthLayout } from "@/components/layout/AuthLayout";

/**
 * Sprint Admin SaaS: /signup public ĐÃ DISABLE.
 * Shop owner được tạo qua admin /admin/shops/new + invite email.
 * Render notice page thay vì form đăng ký.
 *
 * Nếu cần re-enable form: revert commit Sprint Admin SignupPage hoặc
 * resurrect form từ git history (commit trước Sprint Admin).
 */
const CONTACT_ZALO = import.meta.env.VITE_SUPPORT_ZALO ?? "0901234567";
const CONTACT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL ?? "support@taphoa.app";

export function SignupPage() {
  return (
    <AuthLayout
      title="Đăng ký riêng qua chủ phần mềm"
      subtitle="Phần mềm chỉ phục vụ tiệm có hợp đồng"
      footer={
        <Link to="/login" className="text-primary-700 font-medium hover:underline">
          Quay lại đăng nhập
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="w-14 h-14 rounded-full bg-primary-50 flex items-center justify-center">
          <Mail className="w-7 h-7 text-primary-700" />
        </div>
        <p className="text-center text-sm text-ink-muted">
          Để được hỗ trợ tạo tài khoản tiệm, vui lòng liên hệ chủ phần mềm:
        </p>
        <div className="bg-bg rounded-lg p-3 text-sm w-full space-y-1">
          <p>
            <span className="text-ink-muted">Zalo:</span>{" "}
            <span className="font-mono">{CONTACT_ZALO}</span>
          </p>
          <p>
            <span className="text-ink-muted">Email:</span>{" "}
            <span>{CONTACT_EMAIL}</span>
          </p>
        </div>
        <p className="text-center text-xs text-ink-subtle">
          Sau khi tạo tài khoản, bạn sẽ nhận email mời đặt mật khẩu.
        </p>
      </div>
    </AuthLayout>
  );
}
