import { api, ApiError, type AuthUser, type OrgWithRole } from "./api";

/**
 * Lớp xác thực — gọi API tự host thay cho Supabase Auth.
 *
 * Giữ nguyên tên hàm và hình dạng lỗi như bản Supabase để các trang không phải
 * sửa theo.
 */

export type Role = "owner" | "cashier";

export interface Membership {
  org_id: string;
  role: Role;
}

export type { AuthUser, OrgWithRole };

// -----------------------------------------------------------------------------
// Đăng nhập / đăng xuất
// -----------------------------------------------------------------------------

export async function signInWithEmail(email: string, password: string) {
  try {
    return await api.auth.login(email.trim(), password);
  } catch (err) {
    throw toAuthError(err);
  }
}

/**
 * Đăng ký công khai đã TẮT — tài khoản chủ shop do admin tạo hộ (xem trang
 * Quản trị). Giữ hàm này để SignupPage còn chỗ bám, nhưng luôn báo lỗi rõ ràng
 * thay vì gọi một endpoint không tồn tại.
 */
export async function signUpWithEmail(): Promise<never> {
  throw new AuthError(
    "Đăng ký công khai đang tắt. Liên hệ để được tạo tài khoản.",
    "signup-disabled",
  );
}

export async function signOut(): Promise<void> {
  await api.auth.logout();
}

// -----------------------------------------------------------------------------
// Mật khẩu
// -----------------------------------------------------------------------------

export async function resetPasswordForEmail(email: string): Promise<void> {
  try {
    await api.auth.requestPasswordReset(email.trim());
  } catch (err) {
    throw toAuthError(err);
  }
}

/** Đặt lại mật khẩu bằng token trong link email. */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<void> {
  try {
    await api.auth.resetPassword(token, newPassword);
  } catch (err) {
    throw toAuthError(err);
  }
}

/**
 * Đổi mật khẩu khi đang đăng nhập. Server thu hồi toàn bộ refresh token nên
 * mọi thiết bị phải đăng nhập lại — cố ý, vì đổi mật khẩu thường là do nghi lộ.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  try {
    await api.auth.changePassword(currentPassword, newPassword);
  } catch (err) {
    throw toAuthError(err);
  }
}

// -----------------------------------------------------------------------------
// Phiên
// -----------------------------------------------------------------------------

export function hasStoredSession(): boolean {
  return api.hasSession();
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const ctx = await api.auth.me();
    return ctx.user;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Tổ chức
// -----------------------------------------------------------------------------

export async function createOrganization(input: {
  name: string;
  taxCode?: string;
  address?: string;
  phone?: string;
}): Promise<string> {
  try {
    const orgId = await api.rpc<string>("create_organization", {
      p_name: input.name,
      p_tax_code: input.taxCode ?? null,
      p_address: input.address ?? null,
      p_phone: input.phone ?? null,
    });
    if (typeof orgId !== "string") {
      throw new AuthError("Máy chủ trả về định dạng lạ khi tạo tiệm", "create-org-bad-return");
    }
    return orgId;
  } catch (err) {
    throw toAuthError(err);
  }
}

// -----------------------------------------------------------------------------
// currentOrgId trong localStorage
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
// Lỗi
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
 * Chuẩn hoá lỗi từ API về AuthError.
 *
 * Khác bản Supabase: server tự host trả mã lỗi ổn định trong trường `error`,
 * không phải đoán bằng cách so khớp chuỗi tiếng Anh nữa.
 */
function toAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;
  if (err instanceof ApiError) {
    return new AuthError(err.message, err.code);
  }
  return new AuthError(
    err instanceof Error ? err.message : "Có lỗi xảy ra",
    "unknown",
  );
}

export function authErrorMessage(err: unknown): string {
  const e = err instanceof AuthError ? err : toAuthError(err);
  switch (e.code) {
    case "invalid_credentials":
      return "Email hoặc mật khẩu không đúng";
    case "too_many_attempts":
      return "Sai quá nhiều lần. Thử lại sau 15 phút.";
    case "wrong_password":
      return "Mật khẩu hiện tại không đúng";
    case "invalid_token":
      return "Link không hợp lệ hoặc đã hết hạn";
    case "unauthorized":
      return "Phiên đã hết hạn, đăng nhập lại";
    case "forbidden":
      return "Bạn không có quyền thực hiện việc này";
    case "network":
      return "Không kết nối được máy chủ. Kiểm tra mạng và thử lại.";
    case "bad_response":
      return "Máy chủ trả về dữ liệu không hợp lệ";
    case "signup-disabled":
      return e.message;
    default:
      return e.message || "Có lỗi xảy ra, thử lại sau";
  }
}
