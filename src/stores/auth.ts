import type { User } from "@supabase/supabase-js";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { supabase } from "@/integrations/supabase";
import * as authApi from "@/integrations/auth";
import { authErrorMessage } from "@/integrations/auth";
import type { Role } from "@/integrations/auth";
import { productsSync } from "@/integrations/sync/products-sync";
import { ordersSync } from "@/integrations/sync/orders-sync";
import { inventorySync } from "@/integrations/sync/inventory-sync";
import { stockTakeSync } from "@/integrations/sync/stock-take-sync";
import type { Subscription } from "@/types";
import { seedIfEmptyForOrg } from "@/lib/seed";

/**
 * Organization shape khớp Supabase columns (camelCase ở client là không cần;
 * giữ snake_case từ API để khớp Postgres trả về).
 */
export interface Organization {
  id: string;
  name: string;
  tax_code: string | null;
  address: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Membership với org embed qua FK.
 * Query: select('org_id, role, organization:organizations(*)')
 */
export interface MembershipWithOrg {
  org_id: string;
  role: Role;
  organization: Organization;
}

export type AuthStatus = "loading" | "unauthenticated" | "no-org" | "ready";

interface AuthState {
  // identity
  user: User | null;
  fullName: string | null;

  // org context
  memberships: MembershipWithOrg[];
  currentOrgId: string | null;

  // status
  status: AuthStatus;
  error: string | null;

  // Sprint Admin SaaS
  isSuperAdmin: boolean;
  currentSubscription: Subscription | null;

  // actions
  init: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
  ) => Promise<{ error?: string; requiresConfirm?: boolean }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ error?: string }>;
  createOrganization: (input: {
    name: string;
    taxCode?: string;
    address?: string;
    phone?: string;
  }) => Promise<{ error?: string; orgId?: string }>;
  loadMemberships: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  refresh: () => Promise<void>;
  /** Sprint Admin: refetch isSuperAdmin + currentSubscription */
  loadAdminContext: () => Promise<void>;
}

/**
 * Trigger sync layer cho org hiện tại: pull (nếu chưa) + subscribe realtime.
 * KHÔNG gọi từ onAuthStateChange callback trực tiếp (deadlock supabase auth lock).
 * Wrap trong setTimeout(0) ở caller hoặc call sau khi await main flow xong.
 */
async function syncForOrg(orgId: string): Promise<void> {
  if (!orgId) return;
  try {
    // Pull data + subscribe realtime cho products / orders / goods_receipts
    await Promise.all([
      productsSync.pullProductsIfNeeded(orgId),
      ordersSync.pullOrdersIfNeeded(orgId),
      inventorySync.pullReceiptsIfNeeded(orgId),
      stockTakeSync.pullStockTakesIfNeeded(orgId),
    ]);
    productsSync.subscribeRealtime(orgId);
    ordersSync.subscribeRealtime(orgId);
    inventorySync.subscribeRealtime(orgId);
    stockTakeSync.subscribeRealtime(orgId);
    // Dev seed (chỉ DEV + orgId rỗng products): seedIfEmptyForOrg tự kiểm tra
    await seedIfEmptyForOrg(orgId);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[auth.store] syncForOrg failed:", err);
    }
  }
}

interface PersistedState {
  currentOrgId: string | null;
}

const PERSIST_KEY = "pos.auth";

// Module-level flag tránh double-subscribe khi StrictMode mount twice
let _initialized = false;

/**
 * Helper: derive current role từ memberships + currentOrgId
 */
function deriveRole(
  memberships: MembershipWithOrg[],
  currentOrgId: string | null,
): Role | null {
  if (!currentOrgId) return null;
  return memberships.find((m) => m.org_id === currentOrgId)?.role ?? null;
}

/**
 * Helper: derive currentOrg
 */
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

        /*
         * IMPORTANT: KHÔNG dùng async/await bên trong onAuthStateChange callback.
         * Supabase auth client giữ lock khi callback đang chạy; bất kỳ method nào
         * cần access_token (vd. supabase.from().select()) sẽ deadlock chờ lock.
         * Tham chiếu: supabase/auth-js#615.
         *
         * Pattern an toàn: handler chỉ làm set() đồng bộ, defer async bằng
         * setTimeout(0) để callback return trước, lock được release.
         */
        supabase.auth.onAuthStateChange((event, session) => {
          if (event === "SIGNED_OUT") {
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
            // Cleanup sync layer (defer để release auth lock, dù chỉ là method
            // sync, không hại nhưng nhất quán pattern)
            setTimeout(() => {
              productsSync.unsubscribeAndReset();
              ordersSync.unsubscribeAndReset();
              inventorySync.unsubscribeAndReset();
              stockTakeSync.unsubscribeAndReset();
            }, 0);
            return;
          }
          if (
            event === "SIGNED_IN" ||
            event === "TOKEN_REFRESHED" ||
            event === "USER_UPDATED" ||
            event === "INITIAL_SESSION"
          ) {
            if (session?.user) {
              set({
                user: session.user,
                fullName:
                  (session.user.user_metadata?.full_name as string | undefined) ?? null,
              });
              // Defer load memberships để release auth lock
              setTimeout(() => {
                get().loadMemberships();
              }, 0);
            } else if (event === "INITIAL_SESSION") {
              // Page reload không có session → unauthenticated
              set({ status: "unauthenticated" });
            }
            return;
          }
          if (event === "PASSWORD_RECOVERY") {
            // Cho phép vào /reset-password — coi như ready để render form
            if (session?.user) {
              set({
                user: session.user,
                status: "ready",
              });
            }
            return;
          }
        });

        // Trên Supabase v2.x, INITIAL_SESSION sẽ fire ngay sau subscribe
        // → handler ở trên sẽ xử lý. Không cần manual getSession() ở đây nữa.
      },

      signIn: async (email, password) => {
        try {
          await authApi.signInWithEmail(email, password);
          // onAuthStateChange SIGNED_IN sẽ catch và load memberships
          return {};
        } catch (err) {
          return { error: authErrorMessage(err) };
        }
      },

      signUp: async (email, password, fullName) => {
        try {
          const { needsEmailConfirm } = await authApi.signUpWithEmail(
            email,
            password,
            fullName,
          );
          // Khi Confirm email TẮT: auto-login → SIGNED_IN event load memberships
          // Khi BẬT: chưa có session, page hiển thị "Kiểm tra email"
          return { requiresConfirm: needsEmailConfirm };
        } catch (err) {
          return { error: authErrorMessage(err) };
        }
      },

      signOut: async () => {
        try {
          await authApi.signOut();
          // SIGNED_OUT event sẽ clear state
        } catch (err) {
          set({ error: authErrorMessage(err) });
        }
      },

      resetPassword: async (email) => {
        try {
          await authApi.resetPasswordForEmail(email);
          return {};
        } catch (err) {
          return { error: authErrorMessage(err) };
        }
      },

      updatePassword: async (newPassword) => {
        try {
          await authApi.updatePassword(newPassword);
          return {};
        } catch (err) {
          return { error: authErrorMessage(err) };
        }
      },

      createOrganization: async (input) => {
        try {
          const orgId = await authApi.createOrganization(input);
          // Re-fetch memberships để có org mới + membership owner.
          // loadMemberships sẽ triggerSyncForOrg cho org đầu tiên — có thể
          // không phải orgId vừa tạo nếu user đã có org trước đó.
          await get().loadMemberships();
          // Switch explicit sang org vừa tạo + trigger sync cho nó
          set({ currentOrgId: orgId, status: "ready" });
          await syncForOrg(orgId);
          return { orgId };
        } catch (err) {
          return { error: authErrorMessage(err) };
        }
      },

      loadMemberships: async () => {
        try {
          const { data, error } = await supabase
            .from("memberships")
            .select("org_id, role, organization:organizations(*)")
            .returns<MembershipWithOrg[]>();
          if (error) throw error;

          const memberships = data ?? [];
          if (memberships.length === 0) {
            set({
              memberships: [],
              currentOrgId: null,
              status: "no-org",
              error: null,
            });
            return;
          }

          // Validate persisted currentOrgId vẫn match 1 membership
          const stored = get().currentOrgId;
          let nextOrgId: string;
          if (stored && memberships.find((m) => m.org_id === stored)) {
            nextOrgId = stored;
          } else {
            if (stored && import.meta.env.DEV) {
              console.warn(
                `[auth.store] persisted currentOrgId=${stored} không match memberships, fallback memberships[0]`,
              );
            }
            nextOrgId = memberships[0].org_id;
          }
          set({
            memberships,
            currentOrgId: nextOrgId,
            status: "ready",
            error: null,
          });
          // Trigger sync cho org hiện tại (defer để giữ pattern an toàn,
          // tránh chặn render). Sprint Admin: cũng load isSuperAdmin + sub.
          setTimeout(() => {
            syncForOrg(nextOrgId);
            get().loadAdminContext();
          }, 0);
        } catch (err) {
          set({ error: authErrorMessage(err), status: "unauthenticated" });
        }
      },

      switchOrg: async (orgId) => {
        const memberships = get().memberships;
        if (!memberships.find((m) => m.org_id === orgId)) {
          if (import.meta.env.DEV) {
            console.warn(`[auth.store] switchOrg: ${orgId} không thuộc memberships`);
          }
          return;
        }
        if (get().currentOrgId === orgId) return; // no-op nếu đã là current

        // Option B (đã chốt): KHÔNG clear Dexie. Query filter by orgId đảm bảo
        // mỗi org chỉ thấy products của mình. Pull lần đầu cho org mới, các
        // lần sau dùng cache.
        set({ currentOrgId: orgId });
        await syncForOrg(orgId);
        await get().loadAdminContext();
      },

      loadAdminContext: async () => {
        // is_super_admin RPC
        try {
          const { data: isAdmin } = await supabase.rpc("is_super_admin");
          set({ isSuperAdmin: Boolean(isAdmin) });
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[auth.store] is_super_admin check failed:", err);
          }
          set({ isSuperAdmin: false });
        }
        // Load subscription cho currentOrg
        const orgId = get().currentOrgId;
        if (!orgId) {
          set({ currentSubscription: null });
          return;
        }
        try {
          const { data, error } = await supabase
            .from("subscriptions")
            .select("*")
            .eq("org_id", orgId)
            .maybeSingle();
          if (error) throw error;
          if (!data) {
            set({ currentSubscription: null });
            return;
          }
          set({
            currentSubscription: {
              id: data.id,
              orgId: data.org_id,
              tier: data.tier,
              status: data.status,
              monthlyPrice: Number(data.monthly_price),
              trialUntilDate: data.trial_until_date,
              paidUntilDate: data.paid_until_date,
              notes: data.notes,
              createdAt: data.created_at,
              updatedAt: data.updated_at,
            },
          });
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[auth.store] load subscription failed:", err);
          }
          set({ currentSubscription: null });
        }
      },

      refresh: async () => {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          set({
            user: null,
            fullName: null,
            memberships: [],
            currentOrgId: null,
            status: "unauthenticated",
          });
          return;
        }
        set({
          user: data.session.user,
          fullName:
            (data.session.user.user_metadata?.full_name as string | undefined) ?? null,
        });
        await get().loadMemberships();
      },
    }),
    {
      name: PERSIST_KEY,
      partialize: (s): PersistedState => ({ currentOrgId: s.currentOrgId }),
    },
  ),
);

// -----------------------------------------------------------------------------
// Selectors / hooks (giảm boilerplate ở component)
// -----------------------------------------------------------------------------

export function useCurrentOrg(): Organization | null {
  return useAuthStore((s) => deriveOrg(s.memberships, s.currentOrgId));
}

export function useCurrentRole(): Role | null {
  return useAuthStore((s) => deriveRole(s.memberships, s.currentOrgId));
}
