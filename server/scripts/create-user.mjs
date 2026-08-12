/**
 * Tạo tài khoản trực tiếp trong DB. Cần vì /signup công khai đã tắt — tài khoản
 * chủ shop do admin tạo hộ, còn super_admin đầu tiên thì không có đường nào
 * khác ngoài script này.
 *
 * Dùng:
 *   node --env-file=.env scripts/create-user.mjs <email> <password> [--super-admin]
 *
 * Mật khẩu truyền qua tham số dòng lệnh sẽ nằm trong lịch sử shell. Với tài
 * khoản thật, tạo bằng mật khẩu tạm rồi đổi ngay trong app.
 */
import { pool, closePool } from "../src/db.js";
import { hashPassword } from "../src/auth.js";

const [email, password, ...flags] = process.argv.slice(2);
const makeSuperAdmin = flags.includes("--super-admin");

if (!email || !password) {
  console.error("Thiếu tham số.\n  node --env-file=.env scripts/create-user.mjs <email> <password> [--super-admin]");
  process.exit(1);
}

try {
  const hash = await hashPassword(password);
  const { rows } = await pool.query("select auth_create_user($1, $2) as id", [email, hash]);
  const userId = rows[0].id;
  console.log(`Đã tạo user ${email}`);
  console.log(`  id: ${userId}`);

  if (makeSuperAdmin) {
    // bootstrap_super_admin chỉ chạy được một lần (có row là tự khoá), nên
    // dùng nó để không vô tình thêm admin thứ hai bằng script.
    try {
      await pool.query("select bootstrap_super_admin($1)", [email]);
      console.log("  đã đặt làm super_admin");
    } catch (err) {
      console.error(`  KHÔNG đặt được super_admin: ${err.message}`);
      console.error("  (đã có super_admin rồi — thêm thủ công qua trang Quản trị)");
    }
  }
} catch (err) {
  console.error(`Lỗi: ${err.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
