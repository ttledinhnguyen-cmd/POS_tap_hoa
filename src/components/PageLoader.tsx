import { Loader2 } from "lucide-react";

/**
 * Spinner trung tâm dùng cho Suspense fallback (lazy route loading).
 * Match style với AuthGuard 'loading' state để UX nhất quán.
 */
export function PageLoader() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg">
      <Loader2 className="w-8 h-8 animate-spin text-primary-700" />
    </div>
  );
}
