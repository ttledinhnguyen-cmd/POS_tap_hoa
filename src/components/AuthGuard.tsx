import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth";

interface Props {
  children: ReactNode;
  /**
   * Khi true, route này không yêu cầu user thuộc org (vd. /onboarding).
   * Vẫn cần auth, chỉ bỏ qua check membership.
   */
  allowNoOrg?: boolean;
}

/**
 * AuthGuard — đọc status từ useAuthStore (Phase 3).
 *
 * Logic:
 *   loading        → Loader2 trung tâm
 *   unauthenticated → /login
 *   no-org && !allowNoOrg → /onboarding
 *   no-org && allowNoOrg → render children
 *   ready          → render children
 *
 * Subscribe onAuthStateChange đã được store handle ở init() — không cần
 * AuthGuard tự subscribe.
 */
export function AuthGuard({ children, allowNoOrg = false }: Props) {
  const status = useAuthStore((s) => s.status);

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
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
