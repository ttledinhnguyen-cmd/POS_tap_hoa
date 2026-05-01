import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { POSPage } from "@/pages/POSPage";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuthGuard } from "@/components/AuthGuard";
import { PageLoader } from "@/components/PageLoader";
import { useAuthStore } from "@/stores/auth";
import { outboxWorker } from "@/integrations/sync/outbox-worker";
import { productsSync } from "@/integrations/sync/products-sync";
import { ordersSync } from "@/integrations/sync/orders-sync";

// Lazy routes — chỉ load chunk khi user navigate tới (giảm initial bundle).
// POSPage giữ EAGER: route / là entry chính, user mở app vào thẳng đây.
// Pages dùng named export → unwrap về { default } cho React.lazy.
const LoginPage = lazy(() =>
  import("@/pages/auth/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const SignupPage = lazy(() =>
  import("@/pages/auth/SignupPage").then((m) => ({ default: m.SignupPage })),
);
const ForgotPasswordPage = lazy(() =>
  import("@/pages/auth/ForgotPasswordPage").then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import("@/pages/auth/ResetPasswordPage").then((m) => ({
    default: m.ResetPasswordPage,
  })),
);
const OnboardingPage = lazy(() =>
  import("@/pages/auth/OnboardingPage").then((m) => ({
    default: m.OnboardingPage,
  })),
);
const ProductsPage = lazy(() =>
  import("@/pages/ProductsPage").then((m) => ({ default: m.ProductsPage })),
);
const ReportsPage = lazy(() =>
  import("@/pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const OrdersPage = lazy(() =>
  import("@/pages/OrdersPage").then((m) => ({ default: m.OrdersPage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

const VISIBILITY_PULL_THROTTLE_MS = 30_000;
let lastVisiblePull = 0;

export default function App() {
  useEffect(() => {
    // Init auth store: getSession + subscribe onAuthStateChange.
    // Module-level _initialized flag bên trong store đảm bảo idempotent
    // (StrictMode dev mount/unmount kép không double-subscribe).
    useAuthStore.getState().init();

    // Phase 4: outbox worker drain pending sync jobs.
    outboxWorker.start();

    // Phase 5: safety net pull on visibility — nếu tab ẩn lâu, WebSocket
    // realtime có thể bị throttle hoặc miss event. Khi tab focus lại + đã có
    // org, pull để đảm bảo data fresh. Throttle 30s tránh spam.
    const onVisibility = () => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastVisiblePull < VISIBILITY_PULL_THROTTLE_MS) return;
      const orgId = useAuthStore.getState().currentOrgId;
      if (!orgId) return;
      lastVisiblePull = now;
      if (import.meta.env.DEV) {
        console.log("[app] visibility resume → pullProducts + pullOrders");
      }
      productsSync.pullProducts(orgId).catch((err) => {
        if (import.meta.env.DEV) console.warn("[app] pullProducts failed:", err);
      });
      ordersSync.pullOrders(orgId).catch((err) => {
        if (import.meta.env.DEV) console.warn("[app] pullOrders failed:", err);
      });
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      outboxWorker.stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public auth routes — không cần AuthGuard */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Onboarding — cần auth nhưng KHÔNG cần membership */}
          <Route
            path="/onboarding"
            element={
              <AuthGuard allowNoOrg>
                <OnboardingPage />
              </AuthGuard>
            }
          />

          {/* Protected routes — cần auth + cần có org */}
          <Route
            path="/"
            element={
              <AuthGuard>
                <AppLayout mobileChromeless>
                  <POSPage />
                </AppLayout>
              </AuthGuard>
            }
          />
          <Route
            path="/products"
            element={
              <AuthGuard>
                <AppLayout>
                  <ProductsPage />
                </AppLayout>
              </AuthGuard>
            }
          />
          <Route
            path="/reports"
            element={
              <AuthGuard>
                <AppLayout>
                  <ReportsPage />
                </AppLayout>
              </AuthGuard>
            }
          />
          <Route
            path="/orders"
            element={
              <AuthGuard>
                <AppLayout>
                  <OrdersPage />
                </AppLayout>
              </AuthGuard>
            }
          />
          <Route
            path="/settings"
            element={
              <AuthGuard>
                <AppLayout>
                  <SettingsPage />
                </AppLayout>
              </AuthGuard>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
