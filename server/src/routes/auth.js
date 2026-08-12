import { query } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  newRefreshToken,
  sha256,
  refreshExpiry,
  REFRESH_TTL_DAYS,
} from "../auth.js";

// Chặn dò mật khẩu: đếm lần thất bại theo IP + email, khoá tạm khi vượt ngưỡng.
// Để trong RAM là đủ — chỉ có một tiến trình API, và mất khi restart cũng không
// sao. Nếu sau này chạy nhiều instance thì chuyển sang bảng trong Postgres.
const MAX_FAILS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const fails = new Map();

function throttleKey(ip, email) {
  return `${ip}|${String(email ?? "").toLowerCase()}`;
}

function isLockedOut(key) {
  const rec = fails.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > LOCKOUT_MS) {
    fails.delete(key);
    return false;
  }
  return rec.count >= MAX_FAILS;
}

function recordFail(key) {
  const rec = fails.get(key);
  if (!rec || Date.now() - rec.first > LOCKOUT_MS) {
    fails.set(key, { count: 1, first: Date.now() });
  } else {
    rec.count += 1;
  }
}

// Dọn định kỳ để Map không phình mãi
setInterval(() => {
  const cutoff = Date.now() - LOCKOUT_MS;
  for (const [k, v] of fails) if (v.first < cutoff) fails.delete(k);
}, 5 * 60 * 1000).unref();

export default async function authRoutes(app) {
  // Token trả trong JSON chứ không đặt cookie httpOnly. Lý do: giữ nguyên mô
  // hình client hiện tại (supabase-js cũng lưu phiên ở localStorage), tránh
  // phải xử lý CSRF, và luồng offline của PWA đọc token đơn giản hơn. Đổi lại
  // XSS đọc được token — hàng phòng thủ là CSP + không nhúng script bên thứ ba.

  app.post("/login", async (req, reply) => {
    const { email, password } = req.body ?? {};
    const key = throttleKey(req.ip, email);

    if (isLockedOut(key)) {
      return reply.code(429).send({
        error: "too_many_attempts",
        message: "Sai quá nhiều lần. Thử lại sau 15 phút.",
      });
    }
    if (!email || !password) {
      return reply.code(400).send({ error: "missing_credentials", message: "Thiếu email hoặc mật khẩu" });
    }

    const { rows } = await query("select * from auth_find_user_by_email($1)", [email]);
    const user = rows[0];

    // So khớp mật khẩu kể cả khi không có user, để thời gian phản hồi không
    // tiết lộ email nào đã đăng ký.
    const ok = user
      ? await verifyPassword(password, user.password_hash)
      : await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");

    if (!user || !ok) {
      recordFail(key);
      return reply.code(401).send({
        error: "invalid_credentials",
        message: "Email hoặc mật khẩu không đúng",
      });
    }

    fails.delete(key);
    const { token, hash } = newRefreshToken();
    await query("select auth_store_refresh($1, $2, $3, $4)", [
      user.id,
      hash,
      refreshExpiry(),
      req.headers["user-agent"] ?? null,
    ]);
    await query("select auth_record_sign_in($1)", [user.id]);

    const { rows: ctx } = await query("select auth_user_context($1) as ctx", [user.id]);
    return {
      access_token: signAccessToken(user.id),
      refresh_token: token,
      expires_in: 900,
      refresh_expires_in: REFRESH_TTL_DAYS * 86400,
      ...ctx[0].ctx,
    };
  });

  app.post("/refresh", async (req, reply) => {
    const { refresh_token: oldToken } = req.body ?? {};
    if (!oldToken) {
      return reply.code(400).send({ error: "missing_token", message: "Thiếu refresh_token" });
    }

    const { token, hash } = newRefreshToken();
    const { rows } = await query("select auth_rotate_refresh($1, $2, $3, $4) as user_id", [
      sha256(oldToken),
      hash,
      refreshExpiry(),
      req.headers["user-agent"] ?? null,
    ]);
    const userId = rows[0]?.user_id;

    if (!userId) {
      return reply.code(401).send({
        error: "invalid_refresh_token",
        message: "Phiên đã hết hạn, đăng nhập lại",
      });
    }

    return {
      access_token: signAccessToken(userId),
      refresh_token: token,
      expires_in: 900,
      refresh_expires_in: REFRESH_TTL_DAYS * 86400,
    };
  });

  app.post("/logout", async (req) => {
    const { refresh_token: t, all } = req.body ?? {};
    if (all && req.userId) {
      await query("select auth_revoke_all($1)", [req.userId]);
    } else if (t) {
      await query("select auth_revoke_refresh($1)", [sha256(t)]);
    }
    return { ok: true };
  });

  app.get("/me", { preHandler: app.requireAuth }, async (req) => {
    const { rows } = await query("select auth_user_context($1) as ctx", [req.userId]);
    return rows[0].ctx;
  });

  app.post("/change-password", { preHandler: app.requireAuth }, async (req, reply) => {
    const { current_password, new_password } = req.body ?? {};
    if (!current_password || !new_password) {
      return reply.code(400).send({ error: "missing_fields", message: "Thiếu mật khẩu" });
    }

    const { rows: ctx } = await query("select auth_user_context($1) as ctx", [req.userId]);
    const email = ctx[0].ctx?.user?.email;
    const { rows } = await query("select * from auth_find_user_by_email($1)", [email]);
    if (!rows[0] || !(await verifyPassword(current_password, rows[0].password_hash))) {
      return reply.code(401).send({ error: "wrong_password", message: "Mật khẩu hiện tại không đúng" });
    }

    // auth_set_password thu hồi luôn mọi refresh token, kể cả của phiên này —
    // client phải đăng nhập lại. Cố ý: đổi mật khẩu thường là vì nghi bị lộ.
    await query("select auth_set_password($1, $2)", [req.userId, await hashPassword(new_password)]);
    return { ok: true, message: "Đã đổi mật khẩu, cần đăng nhập lại" };
  });

  // Luôn trả 200 dù email có tồn tại hay không — nếu phân biệt thì kẻ xấu dò
  // được danh sách email đã đăng ký.
  app.post("/request-password-reset", async (req) => {
    const { email } = req.body ?? {};
    const generic = { ok: true, message: "Nếu email tồn tại, link đặt lại đã được gửi" };
    if (!email) return generic;

    const { rows } = await query("select * from auth_find_user_by_email($1)", [email]);
    if (!rows[0]) return generic;

    const { token, hash } = newRefreshToken();
    await query("select auth_create_onetime_token($1, $2, 'password_reset', $3)", [
      rows[0].id,
      hash,
      new Date(Date.now() + 3600 * 1000),
    ]);

    // TODO Phase 4: gửi mail qua SMTP của server. Tạm log ra để dev dùng được.
    req.log.warn({ email: rows[0].email, link: `https://ipos123.vn/reset-password?token=${token}` },
      "chưa nối SMTP — link đặt lại mật khẩu chỉ ghi ở log");
    return generic;
  });

  app.post("/reset-password", async (req, reply) => {
    const { token, new_password } = req.body ?? {};
    if (!token || !new_password) {
      return reply.code(400).send({ error: "missing_fields", message: "Thiếu token hoặc mật khẩu mới" });
    }

    const { rows } = await query("select auth_consume_onetime_token($1, 'password_reset') as user_id", [
      sha256(token),
    ]);
    const userId = rows[0]?.user_id;
    if (!userId) {
      return reply.code(400).send({ error: "invalid_token", message: "Link không hợp lệ hoặc đã hết hạn" });
    }

    await query("select auth_set_password($1, $2)", [userId, await hashPassword(new_password)]);
    return { ok: true, message: "Đã đặt lại mật khẩu" };
  });
}
