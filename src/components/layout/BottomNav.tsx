import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Building2,
  HelpCircle,
  LogOut,
  type LucideIcon,
  MoreHorizontal,
  Package,
  Package2,
  Receipt,
  ScanLine,
  Settings,
  ShieldCheck,
} from "lucide-react";

const SUPPORT_ZALO = import.meta.env.VITE_SUPPORT_ZALO ?? "0901234567";
import { useAuthStore } from "@/stores/auth";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
}

/**
 * 4 tab chính + 1 tab "Thêm" (button mở sheet) — tổng 5 cột mobile.
 * Kho hàng / Cài đặt / Admin / Đăng xuất nằm trong sheet "Thêm" để mọi
 * feature đều access được từ mobile mà không chen chúc 1 row.
 */
const PRIMARY_ITEMS: NavItem[] = [
  { to: "/", icon: ScanLine, label: "Bán hàng", end: true },
  { to: "/products", icon: Package, label: "Sản phẩm" },
  { to: "/orders", icon: Receipt, label: "Lịch sử" },
  { to: "/reports", icon: BarChart3, label: "Báo cáo" },
];

const MORE_ITEMS: NavItem[] = [
  { to: "/inventory", icon: Package2, label: "Kho hàng" },
  { to: "/settings", icon: Settings, label: "Cài đặt" },
];

const ADMIN_ITEMS: NavItem[] = [
  { to: "/admin", icon: ShieldCheck, label: "Tổng quan", end: true },
  { to: "/admin/shops", icon: Building2, label: "Cửa hàng" },
];

/**
 * BottomNav — chỉ hiển thị mobile (<768px).
 * Sticky bottom, 5 cột (4 nav + 1 more), touch target tối thiểu 48px.
 *
 * Tab "Thêm" active highlight khi user ở /inventory / /settings / /admin/*
 * để báo "current page nằm trong sheet này".
 */
export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  const signOut = useAuthStore((s) => s.signOut);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Đóng sheet khi navigate sang route mới
  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  // Active state cho tab "Thêm" — true nếu đang ở route nằm trong sheet
  const moreActive =
    location.pathname.startsWith("/inventory") ||
    location.pathname.startsWith("/settings") ||
    location.pathname.startsWith("/admin");

  async function handleLogout() {
    setMoreOpen(false);
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <>
      <nav
        className={cn(
          "md:hidden grid grid-cols-5",
          "bg-bg-card border-t border-line safe-bottom flex-shrink-0",
        )}
      >
        {PRIMARY_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center justify-center gap-1 py-2 min-h-[48px] press",
                isActive ? "text-primary-700" : "text-ink-muted",
              )
            }
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </NavLink>
        ))}
        {/* Tab thứ 5: "Thêm" — button thay vì NavLink */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="Mở menu Thêm"
          aria-expanded={moreOpen}
          className={cn(
            "flex flex-col items-center justify-center gap-1 py-2 min-h-[48px] press",
            moreActive ? "text-primary-700" : "text-ink-muted",
          )}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[10px] font-medium">Thêm</span>
        </button>
      </nav>

      <Sheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="Thêm tính năng"
      >
        <div ref={sheetRef} className="px-3 pb-5 flex flex-col gap-1">
          {MORE_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-3 rounded-lg min-h-[48px] press text-base",
                  isActive
                    ? "bg-primary-50 text-primary-700"
                    : "text-ink hover:bg-bg-subtle",
                )
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}

          {isSuperAdmin && (
            <>
              <div className="pt-3 pb-1 px-3">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-subtle">
                  Quản trị
                </p>
              </div>
              {ADMIN_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-3 rounded-lg min-h-[48px] press text-base",
                      isActive
                        ? "bg-primary-50 text-primary-700"
                        : "text-ink hover:bg-bg-subtle",
                    )
                  }
                >
                  <item.icon className="w-5 h-5 flex-shrink-0" />
                  <span className="font-medium">{item.label}</span>
                </NavLink>
              ))}
            </>
          )}

          <div className="border-t border-line my-2" />

          <a
            href={`https://zalo.me/${SUPPORT_ZALO}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => setMoreOpen(false)}
            className="flex items-center gap-3 px-3 py-3 rounded-lg min-h-[48px] press text-base text-ink hover:bg-bg-subtle"
          >
            <HelpCircle className="w-5 h-5 flex-shrink-0 text-ink-muted" />
            <span className="font-medium">Liên hệ hỗ trợ</span>
          </a>

          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-3 rounded-lg min-h-[48px] press text-base text-danger hover:bg-danger-bg w-full text-left"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            <span className="font-medium">Đăng xuất</span>
          </button>
        </div>
      </Sheet>
    </>
  );
}
