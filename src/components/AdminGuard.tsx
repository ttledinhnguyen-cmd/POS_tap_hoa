import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { useAuthStore } from "@/stores/auth";

interface Props {
  children: ReactNode;
}

/**
 * Wrap admin routes — chỉ super_admin được vào.
 * User thường vào URL trực tiếp → render placeholder + redirect /
 *
 * Lưu ý: AuthGuard đã chạy trước → user authenticated + có org.
 * AdminGuard chỉ thêm 1 check is_super_admin từ store.
 */
export function AdminGuard({ children }: Props) {
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const status = useAuthStore((s) => s.status);

  // Đợi store load isSuperAdmin (sau loadMemberships defer)
  if (status === "loading") return null;

  if (!isSuperAdmin) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center gap-3">
        <ShieldOff className="w-12 h-12 text-ink-subtle" />
        <p className="text-base font-medium">Không có quyền truy cập</p>
        <p className="text-sm text-ink-muted">
          Trang này chỉ dành cho quản trị hệ thống.
        </p>
        <Navigate to="/" replace />
      </div>
    );
  }
  return <>{children}</>;
}
