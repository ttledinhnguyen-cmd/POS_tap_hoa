import type { ReactNode } from "react";
import { Store } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  /**
   * Title hiển thị dưới brand. Vd. "Đăng nhập", "Tạo tài khoản".
   */
  title: string;
  /**
   * Sub text dưới title. Optional.
   */
  subtitle?: string;
  /**
   * Slot footer (link điều hướng giữa pages, vd. "Chưa có tài khoản? Đăng ký").
   */
  footer?: ReactNode;
}

/**
 * AuthLayout — full-screen độc lập, không có sidebar/header/bottomnav.
 *
 *   Mobile: card padding-4 chiếm full screen, vertical center
 *   Desktop: card max-w-md center viewport, shadow-soft
 *
 * Background warm white #FAFAF7. Brand "Tạp Hóa POS" centered ở top.
 */
export function AuthLayout({ children, title, subtitle, footer }: Props) {
  return (
    <div
      className={cn(
        "min-h-dvh bg-bg flex items-start md:items-center justify-center",
        "px-4 py-8 md:py-12",
      )}
    >
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-14 h-14 rounded-xl bg-primary-700 flex items-center justify-center">
            <Store className="w-7 h-7 text-white" />
          </div>
          <p className="text-lg font-semibold tracking-tight">Tạp Hóa POS</p>
        </div>

        {/* Card */}
        <div
          className={cn(
            "bg-bg-card rounded-xl p-6 md:p-8",
            // Mobile: chỉ border nhẹ, không shadow (full screen feel)
            // Desktop: shadow-soft, viền nhẹ
            "border border-line md:shadow-soft md:border-line",
          )}
        >
          <div className="mb-5">
            <h1 className="text-xl font-semibold">{title}</h1>
            {subtitle && (
              <p className="text-sm text-ink-muted mt-1">{subtitle}</p>
            )}
          </div>
          {children}
        </div>

        {/* Footer (link điều hướng) */}
        {footer && (
          <div className="text-center text-sm text-ink-muted mt-5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
