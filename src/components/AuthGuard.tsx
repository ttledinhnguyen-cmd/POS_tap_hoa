import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth";

interface Props {
  children: ReactNode;
  /**
   * Khi true, route này không yêu cầu user thuộc org (vd. /onboarding).
   * Vẫn cần auth, chỉ bỏ qua check membership.
   */
  allowNoOrg?: boolean;
  /**
   * Khi true, route này được render kể cả khi subscription expired/suspended
   * (vd. /subscription-expired, /reports read-only, /settings, /orders).
   */
  allowExpired?: boolean;
}

/**
 * Path prefixes được render ở mode read-only khi subscription expired/suspended.
 * Owner vẫn xem được lịch sử + báo cáo + cài đặt nhưng KHÔNG bán hàng / nhập kho.
 */
const EXPIRED_ALLOWLIST = [
  "/subscription-expired",
  "/reports",
  "/settings",
  "/orders",
  "/admin", // super_admin always passes — but path also free for users (RoleGate inside)
];

function isPathInAllowlist(pathname: string): boolean {
  return EXPIRED_ALLOWLIST.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

/**
 * AuthGuard — multi-stage check:
 *   1. status="loading" → spinner
 *   2. status="unauthenticated" → /login
 *   3. status="no-org" && !allowNoOrg → /onboarding
 *   4. Subscription expired/suspended (NOT super_admin):
 *      - Path in allowlist → render
 *      - Otherwise → /subscription-expired
 *   5. Render children
 *
 * Super_admin BYPASS subscription gate (admin xem app dù sub họ chưa setup).
 */
export function AuthGuard({ children, allowNoOrg = false, allowExpired = false }: Props) {
  const status = useAuthStore((s) => s.status);
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const subscription = useAuthStore((s) => s.currentSubscription);
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-bg">
        <Loader2 className="w-8 h-8 animate-spin text-primary-700" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  if (status === "no-org" && !allowNoOrg) {
    // super_admin chưa có tiệm vẫn phải vào được khu Quản trị để tạo tiệm cho
    // khách. Nhưng CHỈ /admin — mọi route bán hàng khác đều cần một tiệm, cho
    // vào sẽ thành màn hình chết lặng (quét mã không phản hồi, lưu không được).
    const adminException =
      isSuperAdmin &&
      (location.pathname === "/admin" || location.pathname.startsWith("/admin/"));
    if (!adminException) {
      return <Navigate to="/onboarding" replace />;
    }
  }

  // Subscription gate (skip for super_admin + allowExpired routes + no-org wizard)
  if (
    !isSuperAdmin &&
    !allowExpired &&
    status === "ready" &&
    subscription &&
    (subscription.status === "expired" || subscription.status === "suspended")
  ) {
    if (!isPathInAllowlist(location.pathname)) {
      return <Navigate to="/subscription-expired" replace />;
    }
  }

  return <>{children}</>;
}
