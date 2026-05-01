import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  /**
   * Khi true, mobile (<768px) sẽ KHÔNG render Header + BottomNav.
   * Dùng cho POSPage vốn đã có header + action bar nội bộ.
   * Desktop (>=768px) luôn render Sidebar bất kể prop này.
   */
  mobileChromeless?: boolean;
}

/**
 * AppLayout — responsive shell cho mọi route đã đăng nhập.
 *
 *   Mobile (<768px):
 *     - chromeless=false: Header (56px) + page + BottomNav (~64px), tổng h-dvh
 *     - chromeless=true:  page only, h-dvh, page tự quản lý chrome nội bộ
 *
 *   Desktop (>=768px):
 *     - Sidebar 240px sticky-left + main flex-1 (auto height, min h-dvh)
 *     - mobileChromeless prop bị bỏ qua trên desktop
 *
 * Auth pages (Login, Signup, …) sẽ KHÔNG dùng AppLayout — sẽ có
 * <AuthLayout> riêng ở Phase 2.
 */
export function AppLayout({ children, mobileChromeless = false }: Props) {
  return (
    <div className="flex bg-bg">
      <Sidebar />

      <div
        className={cn(
          "flex-1 min-w-0 flex flex-col",
          // Mobile: chiều cao đúng vp để Header/BottomNav neo trên/dưới
          "h-dvh",
          // Desktop: bỏ h cố định, để main grow theo content
          "md:h-auto md:min-h-dvh",
        )}
      >
        {!mobileChromeless && <Header />}

        <div
          className={cn(
            "flex-1 min-h-0",
            // Mobile chrome=true → cần overflow-y-auto cho scroll bên trong;
            // mobile chromeless → page tự handle h-dvh + scroll
            mobileChromeless ? "" : "overflow-y-auto md:overflow-visible",
          )}
        >
          {children}
        </div>

        {!mobileChromeless && <BottomNav />}
      </div>
    </div>
  );
}
