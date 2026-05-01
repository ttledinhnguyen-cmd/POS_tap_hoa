import type { ReactNode } from "react";
import type { Role } from "@/integrations/auth";
import { useCurrentRole } from "@/stores/auth";

interface Props {
  /**
   * Danh sách roles được phép xem children.
   * Vd. ['owner'] để ẩn cashier, ['owner','cashier'] luôn hiển thị nếu có role.
   */
  allow: Role[];
  children: ReactNode;
  /**
   * Hiển thị thay thế khi role không match. Default null (ẩn hoàn toàn).
   * Vd. có thể truyền 1 placeholder "—" hoặc <RoleGate fallback={<p>Chỉ chủ tiệm thấy</p>}>
   */
  fallback?: ReactNode;
}

/**
 * RoleGate — ẩn children khi current role không nằm trong allow.
 *
 * Dùng để gate giá vốn, lãi, báo cáo cho cashier.
 * Sprint 5 sẽ apply ở Cart (price_buy column) + ReportsPage (lãi columns).
 *
 * Lưu ý: đây là CLIENT-SIDE gate, KHÔNG phải security boundary.
 * Server-side phải bảo vệ bằng RLS + RPC. Owner-only data nhạy cảm
 * (giá vốn) phải có policy SQL chặn cashier select column đó.
 */
export function RoleGate({ allow, children, fallback = null }: Props) {
  const role = useCurrentRole();
  if (!role || !allow.includes(role)) return <>{fallback}</>;
  return <>{children}</>;
}
