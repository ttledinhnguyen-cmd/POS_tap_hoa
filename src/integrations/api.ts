/**
 * Client gọi API Tạp Hóa POS — thay cho supabase-js.
 *
 * Backend là Fastify + PostgreSQL tự host trên cùng server với web (xem
 * server/). Cùng origin nên không có CORS, và service worker không phải xử lý
 * ngoại lệ cho request chéo miền.
 *
 * Vì sao không mô phỏng nguyên si API supabase-js: làm vậy là viết lại
 * PostgREST. Bề mặt client thực sự dùng chỉ có vài kiểu truy vấn (đọc theo
 * org_id, upsert sản phẩm, gọi RPC), nên khai tường minh thì ít code hơn và
 * đọc ra ngay đang gọi gì.
 */

const BASE = import.meta.env.VITE_API_URL ?? "/api";

const ACCESS_KEY = "pos.access_token";
const REFRESH_KEY = "pos.refresh_token";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Lỗi tạm (mạng, 5xx) — outbox worker nên thử lại. */
  get isTransient(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }
}

// -----------------------------------------------------------------------------
// Lưu token
// -----------------------------------------------------------------------------
// localStorage chứ không phải cookie httpOnly: giữ nguyên mô hình cũ của
// supabase-js, tránh phải chống CSRF, và luồng offline của PWA đọc token đơn
// giản hơn. Đổi lại XSS đọc được token — hàng phòng thủ là không nhúng script
// bên thứ ba vào app.

function readToken(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeTokens(access: string | null, refresh: string | null): void {
  try {
    if (access) localStorage.setItem(ACCESS_KEY, access);
    else localStorage.removeItem(ACCESS_KEY);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    // Safari private mode chặn localStorage — vẫn chạy được trong phiên hiện tại
  }
}

// -----------------------------------------------------------------------------
// Thông báo đăng xuất
// -----------------------------------------------------------------------------
type SignedOutListener = () => void;
const signedOutListeners = new Set<SignedOutListener>();

/** Đăng ký callback khi phiên hết hạn không cứu được. Trả hàm huỷ đăng ký. */
export function onSignedOut(fn: SignedOutListener): () => void {
  signedOutListeners.add(fn);
  return () => signedOutListeners.delete(fn);
}

function emitSignedOut(): void {
  writeTokens(null, null);
  for (const fn of signedOutListeners) {
    try {
      fn();
    } catch {
      // một listener lỗi không được chặn các listener còn lại
    }
  }
}

// -----------------------------------------------------------------------------
// Làm mới token
// -----------------------------------------------------------------------------
// Gom nhiều request cùng gặp 401 vào MỘT lần refresh. Không gom thì màn hình
// bán hàng bắn 5 request song song lúc mở app sẽ tạo 5 lần refresh, mà refresh
// token xoay vòng nên 4 cái sau dùng token đã thu hồi → server tưởng bị đánh
// cắp và đá sạch mọi phiên.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refresh = readToken(REFRESH_KEY);
    if (!refresh) return false;
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!res.ok) return false;
      const json = await res.json();
      writeTokens(json.access_token, json.refresh_token);
      return true;
    } catch {
      // Mất mạng: KHÔNG xoá token. App offline-first, mạng có lại là dùng tiếp.
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// -----------------------------------------------------------------------------
// Gọi HTTP
// -----------------------------------------------------------------------------
interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** Nội bộ: chặn vòng lặp refresh vô hạn. */
  isRetry?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, isRetry = false } = opts;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = readToken(ACCESS_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    // status 0 = không tới được server. Phân biệt với lỗi từ server để outbox
    // biết đây là lỗi tạm, cứ thử lại.
    throw new ApiError(
      err instanceof Error ? err.message : "Không kết nối được máy chủ",
      0,
      "network",
    );
  }

  if (res.status === 401 && auth && !isRetry) {
    if (await refreshSession()) {
      return request<T>(path, { ...opts, isRetry: true });
    }
    emitSignedOut();
    throw new ApiError("Phiên đã hết hạn, đăng nhập lại", 401, "unauthorized");
  }

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // Nhận HTML thay vì JSON gần như luôn là rule proxy /api bị SPA fallback
      // nuốt mất — báo rõ ra thay vì để "Unexpected token <".
      throw new ApiError("Máy chủ trả về dữ liệu không hợp lệ", res.status, "bad_response");
    }
  }

  if (!res.ok) {
    const e = json as { error?: string; message?: string } | null;
    throw new ApiError(
      e?.message ?? `Lỗi ${res.status}`,
      res.status,
      e?.error ?? "unknown",
    );
  }

  return json as T;
}

// -----------------------------------------------------------------------------
// Kiểu dữ liệu
// -----------------------------------------------------------------------------
export interface AuthUser {
  id: string;
  email: string;
  created_at?: string;
}

export interface OrgSubscription {
  status: string;
  tier: string;
  trial_until_date: string | null;
  paid_until_date: string | null;
  monthly_price: number;
}

export interface OrgWithRole {
  id: string;
  name: string;
  tax_code: string | null;
  address: string | null;
  phone: string | null;
  role: "owner" | "cashier";
  subscription: OrgSubscription | null;
}

export interface UserContext {
  user: AuthUser | null;
  is_super_admin: boolean;
  organizations: OrgWithRole[];
}

interface LoginResponse extends UserContext {
  access_token: string;
  refresh_token: string;
}

// -----------------------------------------------------------------------------
// API công khai
// -----------------------------------------------------------------------------
export const api = {
  hasSession(): boolean {
    return Boolean(readToken(ACCESS_KEY) || readToken(REFRESH_KEY));
  },

  auth: {
    async login(email: string, password: string): Promise<UserContext> {
      const res = await request<LoginResponse>("/auth/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });
      writeTokens(res.access_token, res.refresh_token);
      return {
        user: res.user,
        is_super_admin: res.is_super_admin,
        organizations: res.organizations,
      };
    },

    async logout(): Promise<void> {
      const refresh = readToken(REFRESH_KEY);
      try {
        await request("/auth/logout", { method: "POST", body: { refresh_token: refresh } });
      } catch {
        // Server không xoá được token cũng không sao — xoá phía client là đủ
        // để user không vào tiếp được. Token sẽ tự hết hạn.
      }
      writeTokens(null, null);
    },

    me(): Promise<UserContext> {
      return request<UserContext>("/auth/me");
    },

    changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
      return request("/auth/change-password", {
        method: "POST",
        body: { current_password: currentPassword, new_password: newPassword },
      });
    },

    requestPasswordReset(email: string): Promise<{ ok: boolean }> {
      return request("/auth/request-password-reset", {
        method: "POST",
        body: { email },
        auth: false,
      });
    },

    resetPassword(token: string, newPassword: string): Promise<{ ok: boolean }> {
      return request("/auth/reset-password", {
        method: "POST",
        body: { token, new_password: newPassword },
        auth: false,
      });
    },
  },

  /**
   * Đọc một bảng. RLS lọc theo tiệm ở phía server nên truyền org_id của tiệm
   * khác cũng chỉ nhận về rỗng, không phải lo lọc lại ở client.
   */
  async list<T>(table: string, filters: Record<string, string | number | undefined> = {}): Promise<T[]> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    }
    const q = qs.toString();
    const res = await request<{ data: T[] }>(`/data/${table}${q ? `?${q}` : ""}`);
    return res.data ?? [];
  },

  async upsertProduct<T>(row: Record<string, unknown>): Promise<T> {
    const res = await request<{ data: T }>("/data/products", { method: "POST", body: row });
    return res.data;
  },

  async patchProduct<T>(id: string, patch: Record<string, unknown>): Promise<T> {
    const res = await request<{ data: T }>(`/data/products/${id}`, { method: "PATCH", body: patch });
    return res.data;
  },

  async rpc<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await request<{ data: T }>(`/rpc/${name}`, { method: "POST", body: args });
    return res.data;
  },

  /** Gọi endpoint tuỳ ý (vd. /admin/create-shop) khi không phải RPC thuần. */
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: "POST", body });
  },

  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
};
