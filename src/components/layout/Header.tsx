import { useNavigate } from "react-router-dom";
import { Receipt, Store } from "lucide-react";
import { UserBlock } from "./UserBlock";
import { cn } from "@/lib/utils";

/**
 * Header — chỉ hiển thị mobile (<768px).
 * Cao 56px (h-14), safe-top cho iPhone notch.
 *
 * Layout: [logo+brand] [flex spacer] [Receipt icon → /orders] [UserBlock avatar]
 *
 * Phase 1B: thêm Receipt icon button cho direct access /orders trên mobile.
 * Touch target effective ~36×36 (icon 20px + p-2 padding) — đủ tap accuracy.
 * Trên 320px (iPhone SE Mini): logo32+text~50 + spacer + receipt36 + avatar36 = ~154px.
 * Còn lại ~134px cho spacer — comfortable.
 */
export function Header() {
  const navigate = useNavigate();
  return (
    <header
      className={cn(
        "md:hidden h-14 flex-shrink-0",
        "flex items-center justify-between px-4 gap-2",
        "border-b border-line bg-bg-card safe-top",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-primary-700 flex items-center justify-center flex-shrink-0">
          <Store className="w-4 h-4 text-white" />
        </div>
        <p className="text-sm font-semibold truncate">Tạp Hóa</p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => navigate("/orders")}
          aria-label="Lịch sử đơn hàng"
          className={cn(
            "p-2 rounded-lg press text-ink-muted hover:text-ink hover:bg-bg-subtle",
          )}
        >
          <Receipt className="w-5 h-5" />
        </button>
        <UserBlock variant="menu" />
      </div>
    </header>
  );
}
