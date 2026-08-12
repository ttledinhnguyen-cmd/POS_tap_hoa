import Fastify from "fastify";
import { pool, closePool } from "./db.js";
import { verifyAccessToken } from "./auth.js";
import authRoutes from "./routes/auth.js";
import dataRoutes from "./routes/data.js";
import adminRoutes from "./routes/admin.js";

const PORT = Number(process.env.PORT ?? 8210);
const isProd = process.env.NODE_ENV === "production";

const app = Fastify({
  logger: isProd
    ? { level: "info" }
    : { level: "debug", transport: undefined },
  // IIS đứng trước làm reverse proxy nên req.ip phải lấy từ X-Forwarded-For,
  // không thì mọi request đều thành 127.0.0.1 và throttle đăng nhập vô dụng.
  trustProxy: true,
  bodyLimit: 2 * 1024 * 1024,
});

// -----------------------------------------------------------------------------
// Xác thực
// -----------------------------------------------------------------------------
// Gắn userId cho MỌI request có Bearer hợp lệ, kể cả route không bắt buộc đăng
// nhập (logout cần biết user để thu hồi toàn bộ phiên).
app.decorateRequest("userId", null);

app.addHook("onRequest", async (req) => {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    req.userId = verifyAccessToken(header.slice(7));
  }
});

app.decorate("requireAuth", async (req, reply) => {
  if (!req.userId) {
    return reply.code(401).send({
      error: "unauthorized",
      message: "Cần đăng nhập",
    });
  }
});

// -----------------------------------------------------------------------------
// Lỗi
// -----------------------------------------------------------------------------
app.setErrorHandler((err, req, reply) => {
  // Lỗi do RPC raise exception → thông báo tiếng Việt đã viết sẵn trong DB,
  // trả thẳng cho client. Postgres dùng mã P0001 cho raise_exception.
  if (err.code === "P0001") {
    const msg = err.message ?? "Thao tác không hợp lệ";
    const forbidden = msg.startsWith("Forbidden");
    return reply.code(forbidden ? 403 : 400).send({
      error: forbidden ? "forbidden" : "rpc_error",
      message: msg,
    });
  }
  // 42501 = insufficient_privilege: RLS WITH CHECK chặn ghi sang tiệm khác.
  // Phải là 403 chứ không phải 500 — outbox worker của client retry theo backoff
  // với mọi lỗi, nên trả 500 cho một lỗi phân quyền vĩnh viễn thì nó sẽ thử lại
  // 6 lần rồi mới chịu bỏ, tốn công vô ích.
  if (err.code === "42501") {
    return reply.code(403).send({
      error: "forbidden",
      message: "Không có quyền ghi dữ liệu cho tiệm này",
    });
  }
  if (err.code === "23505") {
    return reply.code(409).send({ error: "conflict", message: "Dữ liệu đã tồn tại" });
  }
  if (err.code === "23503") {
    return reply.code(409).send({ error: "fk_violation", message: "Dữ liệu tham chiếu không tồn tại" });
  }
  if (err.validation) {
    return reply.code(400).send({ error: "bad_request", message: err.message });
  }

  req.log.error({ err }, "lỗi chưa xử lý");
  return reply.code(500).send({ error: "internal", message: "Lỗi máy chủ" });
});

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------
app.get("/api/health", async () => {
  const { rows } = await pool.query("select now() as now");
  return { ok: true, db: "up", now: rows[0].now };
});

await app.register(authRoutes, { prefix: "/api/auth" });
await app.register(dataRoutes, { prefix: "/api" });
await app.register(adminRoutes, { prefix: "/api/admin" });

// -----------------------------------------------------------------------------
// Khởi động
// -----------------------------------------------------------------------------
// Chỉ nghe trên loopback: IIS proxy từ ipos123.vn/api vào đây. Không mở ra
// ngoài để cổng 8210 không lộ trên internet.
try {
  await app.listen({ port: PORT, host: "127.0.0.1" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    app.log.info(`nhận ${sig}, đang tắt...`);
    await app.close();
    await closePool();
    process.exit(0);
  });
}
