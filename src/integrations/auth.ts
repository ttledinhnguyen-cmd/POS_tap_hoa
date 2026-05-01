import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

/**
 * Auth helpers — wrap Supabase Auth + RPC create_organization.
 * Phase 2 stub: gọi trực tiếp, không qua Zustand. Phase 3 sẽ refactor.
 */

export type Role = "owner" | "cashier";

export interface Membership {
  org_id: string;
  role: Role;
}

// -----------------------------------------------------------------------------
// Sign in / sign up / sign out
// -----------------------------------------------------------------------------

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new AuthError(error.message, mapAuthErrorCode(error.message));
  if (!data.user) throw new AuthError("Không lấy được thông tin user", "no-user");
  return data.user;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  fullName: string,
): Promise<{ user: User | null; needsEmailConfirm: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });
  if (error) throw new AuthError(error.message, mapAuthErrorCode(error.message));
  // Khi "Confirm email" bật ở Dashboard, session = null (chờ user click email).
  // Khi tắt, session có ngay → auto-login.
  return {
    user: data.user,
    needsEmailConfirm: data.user !== null && data.session === null,
  };
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new AuthError(error.message, "sign-out-failed");
}

// -----------------------------------------------------------------------------
// Password reset
// -----------------------------------------------------------------------------

export async function resetPasswordForEmail(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw new AuthError(error.message, mapAuthErrorCode(error.message));
}

export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new AuthError(error.message, mapAuthErrorCode(error.message));
}

// -----------------------------------------------------------------------------
// Session / user
// -----------------------------------------------------------------------------

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new AuthError(error.message, "get-session-failed");
  return data.session;
}

export async function getCurrentUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    // Không có user = không lỗi, return null
    return null;
  }
  return data.user;
}

// -----------------------------------------------------------------------------
// Memberships / organization
// -----------------------------------------------------------------------------

/**
 * Lấy danh sách memberships của user hiện tại.
 * RLS policy memberships_select_self_or_org cho phép user đọc row của chính mình.
 */
export async function getCurrentMemberships(): Promise<Membership[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("org_id, role");
  if (error) throw new AuthError(error.message, "get-memberships-failed");
  return (data ?? []) as Membership[];
}

/**
 * Tạo organization mới + tự gán user làm owner (atomic, qua RPC trong migration 0003).
 * Returns: org_id của tiệm vừa tạo.
 */
export async function createOrganization(input: {
  name: string;
  taxCode?: string;
  address?: string;
  phone?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: input.name,
    p_tax_code: input.taxCode ?? null,
    p_address: input.address ?? null,
    p_phone: input.phone ?? null,
  });
  if (error) throw new AuthError(error.message, "create-org-failed");
  if (typeof data !== "string") {
    throw new AuthError("RPC create_organization trả về định dạng lạ", "create-org-bad-return");
  }
  return data;
}

// -----------------------------------------------------------------------------
// localStorage cho currentOrgId (Phase 2 stub — Phase 3 wire vào Zustand)
// -----------------------------------------------------------------------------

const ORG_KEY = "pos.currentOrgId";

export function getStoredOrgId(): string | null {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function setStoredOrgId(orgId: string | null): void {
  try {
    if (orgId) localStorage.setItem(ORG_KEY, orgId);
    else localStorage.removeItem(ORG_KEY);
  } catch {
    // ignore
  }
}

// -----------------------------------------------------------------------------
// Error normalization
// -----------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Map Supabase Auth error messages → mã lỗi ngắn để layer trên dịch tiếng Việt.
 * Supabase không expose error.code ổn định, phải match theo string.
 */
function mapAuthErrorCode(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "invalid-credentials";
  if (m.includes("email not confirmed")) return "email-not-confirmed";
  if (m.includes("user already registered")) return "user-exists";
  if (m.includes("password should be at least")) return "weak-password";
  if (m.includes("invalid email") || m.includes("email address")) return "invalid-email";
  if (m.includes("rate limit") || m.includes("too many requests")) return "rate-limited";
  if (m.includes("network") || m.includes("fetch")) return "network";
  return "unknown";
}

/**
 * Dịch mã lỗi sang thông báo tiếng Việt user-friendly.
 */
export function authErrorMessage(err: unknown): string {
  if (err instanceof AuthError) {
    switch (err.code) {
      case "invalid-credentials":
        return "Email hoặc mật khẩu không đúng";
      case "email-not-confirmed":
        return "Email chưa xác minh. Kiểm tra hộp thư của bạn.";
      case "user-exists":
        return "Email đã được sử dụng";
      case "weak-password":
        return "Mật khẩu phải có ít nhất 6 ký tự";
      case "invalid-email":
        return "Email không hợp lệ";
      case "rate-limited":
        return "Quá nhiều lần thử. Vui lòng đợi vài phút.";
      case "network":
        return "Lỗi mạng. Kiểm tra kết nối và thử lại.";
      default:
        return err.message || "Có lỗi xảy ra, thử lại sau";
    }
  }
  if (err instanceof Error) return err.message;
  return "Có lỗi xảy ra, thử lại sau";
}
