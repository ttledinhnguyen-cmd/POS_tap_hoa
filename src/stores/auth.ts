import { create } from "zustand";
import { persist } from "zustand/middleware";
import { api, onSignedOut, type AuthUser, type UserContext } from "@/integrations/api";
import * as authApi from "@/integrations/auth";
import { authErrorMessage } from "@/integrations/auth";
import type { Role } from "@/integrations/auth";
import { productsSync } from "@/integrations/sync/products-sync";
import { ordersSync } from "@/integrations/sync/orders-sync";
import { inventorySync } from "@/integrations/sync/inventory-sync";
import { stockTakeSync } from "@/integrations/sync/stock-take-sync";
import { categoriesSync } from "@/integrations/sync/categories-sync";
import type { Subscription } from "@/types";
import { seedIfEmptyForOrg } from "@/lib/seed";

export interface Organization {
  id: string;
  name: string;
  tax_code: string | null;
  address: string | null;
  address_full: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
}

export interface MembershipWithOrg {
  org_id: string;
  role: Role;
  organization: Organization;
}

export type AuthStatus = "loading" | "unauthenticated" | "no-org" | "ready";

interface AuthState {
  user: AuthUser | null;
  fullName: string | null;

  memberships: MembershipWithOrg[];
  currentOrgId: string | null;

  status: AuthStatus;
  error: string | null;

  isSuperAdmin: boolean;
  currentSubscription: Subscription | null;

  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error?: string; requiresConfirm?: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  changePassword: (current: string, next: string) => Promise<{ error?: string }>;
  resetPasswordWithToken: (token: string, next: string) => Promise<{ error?: string }>;
  createOrganization: (input: {
    name: string;
    taxCode?: string;
    address?: string;
    phone?: string;
  }) => Promise<{ error?: string; orgId?: string }>;
  loadMemberships: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  refresh: () => Promise<void>;
  loadAdminContext: () => Promise<void>;
  /** Nội bộ: nạp kết quả /auth/me vào state. Không gọi từ component. */
  applyContext: (ctx: UserContext) => Promise<void>;
}

/**
 * Kéo dữ liệu + bật đồng bộ định kỳ cho tiệm hiện tại.
 *
 * Khác bản Supabase: không còn realtime websocket, các module sync tự poll
 * theo `updated_at` (xem từng file *-sync.ts). Bản Supabase phải defer bằng
 * setTimeout(0) để tránh deadlock auth lock — giờ không còn lock nào nên gọi
 * thẳng được.
 */
async function syncForOrg(orgId: string): Promise<void> {
  if (!orgId) return;
  try {
    await Promise.all([
      productsSync.pullProductsIfNeeded(orgId),
      ordersSync.pullOrdersIfNeeded(orgId),
      inventorySync.pullReceiptsIfNeeded(orgId),
      stockTakeSync.pullStockTakesIfNeeded(orgId),
      categoriesSync.pullCategoriesIfNeeded(orgId),
    ]);
    productsSync.startPolling(orgId);
    ordersSync.startPolling(orgId);
    inventorySync.startPolling(orgId);
    stockTakeSync.startPolling(orgId);
    categoriesSync.startPolling(orgId);
    await seedIfEmptyForOrg(orgId);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[auth.store] syncForOrg thất bại:", err);
    }
  }
}

function stopAllSync(): void {
  productsSync.stopAndReset();
  ordersSync.stopAndReset();
  inventorySync.stopAndReset();
  stockTakeSync.stopAndReset();
  categoriesSync.stopAndReset();
}

/** Chuyển kết quả /auth/me sang hình dạng store đang dùng. */
function fromContext(ctx: UserContext): {
  memberships: MembershipWithOrg[];
  subscriptionByOrg: Map<string, Subscription>;
} {
  const memberships: MembershipWithOrg[] = [];
  const subscriptionByOrg = new Map<string, Subscription>();

  for (const o of ctx.organizations ?? []) {
    memberships.push({
      org_id: o.id,
      role: o.role,
      organization: {
        id: o.id,
        name: o.name,
        tax_code: o.tax_code,
        address: o.address,
        address_full: null,
        phone: o.phone,
        latitude: null,
        longitude: null,
        created_at: "",
        updated_at: "",
      },
    });
    if (o.subscription) {
      subscriptionByOrg.set(o.id, {
        id: "",
        orgId: o.id,
        tier: o.subscription.tier,
        status: o.subscription.status,
        monthlyPrice: Number(o.subscription.monthly_price),
        trialUntilDate: o.subscription.trial_until_date,
        paidUntilDate: o.subscription.paid_until_date,
        notes: null,
        createdAt: "",
        updatedAt: "",
      } as Subscription);
    }
  }
  return { memberships, subscriptionByOrg };
}

interface PersistedState {
  currentOrgId: string | null;
}

const PERSIST_KEY = "pos.auth";

let _initialized = false;

function deriveRole(memberships: MembershipWithOrg[], currentOrgId: string | null): Role | null {
  if (!currentOrgId) return null;
  return memberships.find((m) => m.org_id === currentOrgId)?.role ?? null;
}

function deriveOrg(
  memberships: MembershipWithOrg[],
  currentOrgId: string | null,
): Organization | null {
  if (!currentOrgId) return null;
  return memberships.find((m) => m.org_id === currentOrgId)?.organization ?? null;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      fullName: null,
      memberships: [],
      currentOrgId: null,
      status: "loading",
      error: null,
      isSuperAdmin: false,
      currentSubscription: null,

      init: async () => {
        if (_initialized) return;
        _initialized = true;

        // Refresh token hết hạn hoặc bị thu hồi → dọn state và đưa về màn đăng
        // nhập. Đăng ký một lần ở đây thay cho onAuthStateChange của Supabase.
        onSignedOut(() => {
          set({
            user: null,
            fullName: null,
            memberships: [],
            currentOrgId: null,
            status: "unauthenticated",
            error: null,
            isSuperAdmin: false,
            currentSubscription: null,
          });
          stopAllSync();
        });

        if (!api.hasSession()) {
          set({ status: "unauthenticated" });
          return;
        }
        await get().loadMemberships();
      },

      signIn: async (email, password) => {
        try {
          const ctx = await authApi.signInWithEmail(email, password);
          await get().applyContext(ctx);
          return {};
        } catch (err) {
          return { error: authErrorMessage(err) };
        }
      },

      signUp: async () => {
        return { error: authErrorMessage(new Error("Đăng ký công khai đang tắt")) };
      },

      signOut: async () => {
        try {
          await authApi.signOut();
        } catch (err) {
          if (import.meta.env.DEV) console.warn("[auth.store] signOut:", err);
        }
        stopAllSync();
        set({
          user: null,
          fullName: null,
          memberships: [],
          currentOrgId: null,
          status: "unauthenticated",
          error: null,
          isSuperAdmin: false,
          currentSubscription: null,
        });
      },

      resetPassword: async (email) => {
        try {
          await authApi.resetPasswordForEmail(email);
          return {};
        } catch (err) {
          return { error: authErrorMessage(err) };
        }
      },

      changePassword: async (current, next) => {
        try {
          await authApi.changePassword(current, next);
          // Server đã thu hồi mọi refresh token, kể cả của phiên này.
          await get().signOut();
          return {};
        } catch (err) {
          return { error: authErrorMessage(err) };
        }
      },

      resetPasswordWithToken: async (token, next) => {
        try {
          await authApi.resetPasswordWithToken(token, next);
          return {};
        } catch (err) {
          return { error: authErrorMessage(err) };
        }
      },

      createOrganization: async (input) => {
        try {
          const orgId = await authApi.createOrganization(input);
          await get().loadMemberships();
          set({ currentOrgId: orgId, status: "ready" });
          await syncForOrg(orgId);
          return { orgId };
        } catch (err) {
          return { error: authErrorMessage(err) };
        }
      },

      loadMemberships: async () => {
        try {
          const ctx = await api.auth.me();
          await get().applyContext(ctx);
        } catch (err) {
          set({ error: authErrorMessage(err), status: "unauthenticated" });
        }
      },

      /**
       * Một lời gọi /auth/me trả đủ user + tiệm + vai trò + subscription +
       * cờ super_admin, nên không cần tách loadMemberships và loadAdminContext
       * thành hai vòng gọi mạng như bản Supabase.
       */
      applyContext: async (ctx: UserContext) => {
        const { memberships, subscriptionByOrg } = fromContext(ctx);

        set({
          user: ctx.user,
          fullName: ctx.user?.email ?? null,
          isSuperAdmin: Boolean(ctx.is_super_admin),
        });

        if (memberships.length === 0) {
          // "no-org" cho MỌI user, kể cả super_admin. Trước đây super_admin
          // được cho "ready" để vào trang Quản trị, nhưng như vậy họ lọt luôn
          // vào màn hình bán hàng với orgId rỗng — quét mã không phản hồi,
          // nhập kho không lưu, chẳng báo lỗi gì. Ngoại lệ cho /admin xử lý ở
          // AuthGuard, nơi biết được route hiện tại.
          set({
            memberships: [],
            currentOrgId: null,
            currentSubscription: null,
            status: "no-org",
            error: null,
          });
          return;
        }

        const stored = get().currentOrgId;
        const nextOrgId =
          stored && memberships.some((m) => m.org_id === stored)
            ? stored
            : memberships[0].org_id;

        set({
          memberships,
          currentOrgId: nextOrgId,
          currentSubscription: subscriptionByOrg.get(nextOrgId) ?? null,
          status: "ready",
          error: null,
        });

        await syncForOrg(nextOrgId);
      },

      switchOrg: async (orgId) => {
        const memberships = get().memberships;
        if (!memberships.some((m) => m.org_id === orgId)) {
          if (import.meta.env.DEV) {
            console.warn(`[auth.store] switchOrg: ${orgId} không thuộc memberships`);
          }
          return;
        }
        if (get().currentOrgId === orgId) return;

        set({ currentOrgId: orgId });
        await get().loadAdminContext();
        await syncForOrg(orgId);
      },

      loadAdminContext: async () => {
        try {
          const ctx = await api.auth.me();
          const { subscriptionByOrg } = fromContext(ctx);
          const orgId = get().currentOrgId;
          set({
            isSuperAdmin: Boolean(ctx.is_super_admin),
            currentSubscription: orgId ? (subscriptionByOrg.get(orgId) ?? null) : null,
          });
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[auth.store] loadAdminContext thất bại:", err);
          }
        }
      },

      refresh: async () => {
        if (!api.hasSession()) {
          set({
            user: null,
            fullName: null,
            memberships: [],
            currentOrgId: null,
            status: "unauthenticated",
          });
          return;
        }
        await get().loadMemberships();
      },
    }),
    {
      name: PERSIST_KEY,
      partialize: (s): PersistedState => ({ currentOrgId: s.currentOrgId }),
    },
  ),
);

export function useCurrentOrg(): Organization | null {
  return useAuthStore((s) => deriveOrg(s.memberships, s.currentOrgId));
}

export function useCurrentRole(): Role | null {
  return useAuthStore((s) => deriveRole(s.memberships, s.currentOrgId));
}
