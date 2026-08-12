import crypto from "node:crypto";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";

const scrypt = promisify(crypto.scrypt);

// Dùng scrypt của Node thay vì bcrypt/argon2. Hai thư viện kia cần biên dịch
// native (node-gyp), mà server này không có build tool C++ — cài sẽ vỡ. scrypt
// nằm sẵn trong Node, là KDF chuẩn cho mật khẩu, và không có rủi ro build.
const SCRYPT_N = 16384; // ~16 MB bộ nhớ mỗi lần băm, ~50ms
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

const ACCESS_TTL = "15m";
// Refresh dài ngày vì máy tính tiền mở suốt, bắt đăng nhập lại giữa ca bán
// hàng là hỏng việc.
export const REFRESH_TTL_DAYS = 60;

function requireSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error("JWT_SECRET thiếu hoặc quá ngắn (cần >= 32 ký tự)");
  }
  return s;
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length < 6) {
    throw new Error("Mật khẩu phải từ 6 ký tự");
  }
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  let expected;
  try {
    expected = Buffer.from(hashB64, "base64");
    const key = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    // timingSafeEqual để không lộ thông tin qua thời gian so sánh
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

export function signAccessToken(userId) {
  return jwt.sign({ sub: userId }, requireSecret(), {
    expiresIn: ACCESS_TTL,
    algorithm: "HS256",
  });
}

/** Trả về userId, hoặc null nếu token sai/hết hạn. */
export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, requireSecret(), { algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Sinh refresh token. Trả bản gốc (gửi cho client) và bản băm (lưu DB).
 * DB chỉ giữ bản băm nên lộ DB không dựng lại được phiên.
 */
export function newRefreshToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function refreshExpiry() {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 3600 * 1000);
}
