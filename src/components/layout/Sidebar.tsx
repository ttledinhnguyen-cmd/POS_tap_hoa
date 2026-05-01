import { NavLink } from "react-router-dom";
import {
  BarChart3,
  type LucideIcon,
  Package,
  Package2,
  Receipt,
  ScanLine,
  Settings,
  Store,
} from "lucide-react";
import { UserBlock } from "./UserBlock";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", icon: ScanLine, label: "Bán hàng", end: true },
  { to: "/products", icon: Package, label: "Sản phẩm" },
  { to: "/inventory", icon: Package2, label: "Kho hàng" },
  { to: "/reports", icon: BarChart3, label: "Báo cáo" },
  { to: "/orders", icon: Receipt, label: "Lịch sử" },
  { to: "/settings", icon: Settings, label: "Cài đặt" },
];

/**
 * Sidebar — chỉ hiển thị md+ (>=768px).
 * Sticky left, height = viewport, có UserBlock ở dưới cùng.
 */
export function Sidebar() {
  return (
    <aside
      className={cn(
        "hidden md:flex md:flex-col",
        "md:w-60 md:flex-shrink-0",
        "md:sticky md:top-0 md:h-dvh",
        "md:border-r md:border-line md:bg-bg-card",
      )}
    >
      {/* Logo / brand */}
      <div className="flex items-center gap-2 px-4 h-16 border-b border-line">
        <div className="w-8 h-8 rounded-lg bg-primary-700 flex items-center justify-center">
          <Store className="w-4 h-4 text-white" />
        </div>
        <p className="text-base font-semibold">Tạp Hóa</p>
      </div>

      {/* Nav items */}
      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg",
                "min-h-[40px] text-sm font-medium press",
                isActive
                  ? "bg-primary-50 text-primary-700"
                  : "text-ink-muted hover:bg-bg-subtle hover:text-ink",
              )
            }
          >
            <item.icon className="w-5 h-5 flex-shrink-0" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User block — bottom */}
      <div className="border-t border-line p-3">
        <UserBlock variant="sidebar" />
      </div>
    </aside>
  );
}
