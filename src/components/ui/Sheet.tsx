import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Sheet — responsive overlay container.
 *
 *   Mobile (<768px): slide-from-bottom, full-width, rounded top, drag handle.
 *   Desktop (>=768px): center modal max-w-md, rounded all corners, no drag handle,
 *                      backdrop click vẫn đóng.
 *
 * Existing call sites (PaymentSheet) không cần đổi — chỉ Sheet container đổi.
 */
export function Sheet({ open, onClose, title, children, className }: Props) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center",
        "items-end md:items-center",
        "md:p-4",
      )}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 animate-in fade-in"
        onClick={onClose}
      />

      {/* Sheet container */}
      <div
        className={cn(
          "relative w-full max-w-md bg-bg-card shadow-sheet flex flex-col",
          // Corners: bo trên mobile (slide from bottom), bo full desktop (modal)
          "rounded-t-xl md:rounded-xl",
          // Height limits
          "max-h-[90dvh] md:max-h-[85dvh]",
          // Safe-area mobile only — desktop modal không cần
          "safe-bottom md:pb-0",
          // Animations (uses tailwindcss-animate-style classes nếu plugin có;
          // hiện chưa có, no-op nhưng giữ để future)
          "animate-in slide-in-from-bottom duration-200",
          className,
        )}
      >
        {/* Drag handle — chỉ mobile */}
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div className="w-10 h-1 rounded-full bg-line-strong" />
        </div>

        {title && (
          <div className="flex items-center justify-between px-5 pt-2 pb-3 md:pt-5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 -mr-2 rounded-lg press hover:bg-bg-subtle"
              aria-label="Đóng"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
