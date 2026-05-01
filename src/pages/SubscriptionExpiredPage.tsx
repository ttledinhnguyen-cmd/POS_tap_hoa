import { useNavigate } from "react-router-dom";
import { AlertTriangle, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuthStore, useCurrentOrg } from "@/stores/auth";

const CONTACT_ZALO = import.meta.env.VITE_SUPPORT_ZALO ?? "0901234567";
const CONTACT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL ?? "support@taphoa.app";

/**
 * Trang hiển thị khi subscription hết hạn / bị suspend.
 * Allow-list paths trong AuthGuard cho phép user vẫn xem được:
 *   /reports (read-only), /settings, /orders, /admin/*
 */
export function SubscriptionExpiredPage() {
  const navigate = useNavigate();
  const subscription = useAuthStore((s) => s.currentSubscription);
  const currentOrg = useCurrentOrg();
  const signOut = useAuthStore((s) => s.signOut);

  const isSuspended = subscription?.status === "suspended";
  const title = isSuspended ? "Tài khoản đã bị tạm khóa" : "Gói đăng ký đã hết hạn";
  const reason = isSuspended
    ? "Tài khoản tiệm của bạn hiện đang bị tạm khóa. Vui lòng liên hệ chủ phần mềm để được hỗ trợ."
    : "Để tiếp tục bán hàng, vui lòng liên hệ chủ phần mềm gia hạn gói đăng ký.";

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-6">
      <div className="bg-bg-card border border-line rounded-xl shadow-soft max-w-md w-full p-6 flex flex-col gap-5">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full bg-danger-bg flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-danger" />
          </div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-ink-muted">{reason}</p>
          {currentOrg && (
            <p className="text-xs text-ink-subtle">
              Tiệm: <span className="font-medium text-ink">{currentOrg.name}</span>
            </p>
          )}
        </div>

        <div className="bg-bg rounded-lg p-4 text-sm space-y-1">
          <p className="font-medium">Liên hệ hỗ trợ</p>
          <p className="text-ink-muted">
            Zalo: <span className="text-ink font-mono">{CONTACT_ZALO}</span>
          </p>
          <p className="text-ink-muted">
            Email: <span className="text-ink">{CONTACT_EMAIL}</span>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={() => navigate("/reports")}
          >
            <BarChart3 className="w-4 h-4" />
            Vào báo cáo (xem được khi hết hạn)
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={async () => {
              await signOut();
              navigate("/login", { replace: true });
            }}
          >
            Đăng xuất
          </Button>
        </div>
      </div>
    </div>
  );
}
