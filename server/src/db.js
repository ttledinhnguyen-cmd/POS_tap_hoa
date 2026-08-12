import pg from "pg";

// Tiền lưu bigint trong Postgres. Driver mặc định trả bigint dạng string để
// khỏi mất chính xác. Doanh thu tạp hóa không bao giờ vượt 2^53 đồng (9 triệu
// tỷ) nên ép về number an toàn, và giúp JSON trả về đúng kiểu client mong đợi.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));
// numeric (stock, quantity, tax_rate) — cũng trả string mặc định
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  console.error("[db] lỗi trên client đang rảnh:", err.message);
});

/**
 * Truy vấn không cần ngữ cảnh user.
 *
 * Chỉ dùng để GỌI CÁC FUNCTION auth_* — users/refresh_tokens/auth_tokens cố ý
 * không có policy RLS nào cho ipos_app, nên đọc thẳng sẽ ra rỗng. Các function
 * đó là SECURITY DEFINER nên chạy được.
 *
 * Truy vấn dữ liệu nghiệp vụ (products, orders...) PHẢI đi qua `withUser`,
 * nếu không RLS sẽ lọc sạch và trả về rỗng — đúng như thiết kế.
 */
export function query(sql, params) {
  return pool.query(sql, params);
}

/**
 * Chạy trong transaction VỚI ngữ cảnh user, để RLS lọc dữ liệu.
 *
 * `set_config(..., true)` = LOCAL, chỉ sống trong transaction này. Đây là chi
 * tiết sống còn: connection lấy từ pool và dùng lại cho request của user khác,
 * nếu set GLOBAL thì user sau sẽ kế thừa danh tính của user trước.
 *
 * Mọi truy vấn của một request phải nằm trong cùng một transaction, vì thế
 * callback nhận `client` và phải dùng nó, không dùng `query()` bên ngoài.
 */
export async function withUser(userId, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.user_id', $1, true)", [userId ?? ""]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// CỐ Ý KHÔNG có hàm chạy dưới quyền ipos_owner.
//
// Cách đó đòi `GRANT ipos_owner TO ipos_app` rồi `SET ROLE`, mà cấp xong thì
// ipos_app tự nâng quyền bất cứ lúc nào và toàn bộ ranh giới RLS thành vô
// nghĩa. Việc gì cần bỏ qua RLS thì viết thành một SECURITY DEFINER function
// cụ thể trong server/db/auth-functions.sql — bề mặt nhỏ, đọc lại được.

export async function closePool() {
  await pool.end();
}
