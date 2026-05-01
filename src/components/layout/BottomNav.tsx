import { NavLink } from "react-router-dom";
import {
  BarChart3,
  type LucideIcon,
  Package,
  ScanLine,
  Settings,
} from "lucide-react";
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
  { to: "/reports", icon: BarChart3, label: "Báo cáo" },
  { to: "/settings", icon: Settings, label: "Cài đặt" },
];

/**
 * BottomNav — chỉ hiển thị mobile (<768px).
 * Sticky bottom, 3 cột bằng nhau, touch target tối thiểu 48px.
 */
export function BottomNav() {
  return (
    <nav
      className={cn(
        "md:hidden grid grid-cols-4",
        "bg-bg-card border-t border-line safe-bottom flex-shrink-0",
      )}
    >
      {NAV_ITEMS.map((item) => (
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
          <item.icon className="w-6 h-6" />
          <span className="text-[11px] font-medium">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
