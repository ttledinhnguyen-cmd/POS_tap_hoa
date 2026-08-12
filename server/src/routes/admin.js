import crypto from "node:crypto";
import { query, withUser } from "../db.js";
import { hashPassword, newRefreshToken } from "../auth.js";

const INVITE_TTL_HOURS = 72;

/**
 * Thay Edge Function `admin-create-shop` của Supabase.
 *
 * Ba việc phải làm trong một luồng: tạo tiệm + subscription, tạo tài khoản chủ
 * shop nếu chưa có, và gắn họ làm owner. RPC không tự làm hết được vì băm mật
 * khẩu phải chạy ở Node.
 */
export default async function adminRoutes(app) {
  app.addHook("preHandler", app.requireAuth);

  app.post("/create-shop", async (req, reply) => {
    const b = req.body ?? {};
    if (!b.org_name?.trim() || !b.owner_email?.trim()) {
      return reply.code(400).send({
        error: "missing_fields",
        message: "Thiếu tên tiệm hoặc email chủ shop",
      });
    }

    // admin_create_shop tự kiểm tra super_admin và ném lỗi nếu không phải.
    const created = await withUser(req.userId, async (c) => {
      const { rows } = await c.query(
        `select public.admin_create_shop($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result`,
        [
          b.org_name.trim(),
          b.owner_email.trim(),
          b.tax_code ?? null,
          b.address ?? null,
          b.address_full ?? null,
          b.phone ?? null,
          b.latitude ?? null,
          b.longitude ?? null,
          b.trial_days ?? 30,
          b.monthly_price ?? 199000,
        ],
      );
      return rows[0].result;
    });

    const orgId = created.org_id;

    // Mật khẩu tạm ngẫu nhiên: chủ shop không bao giờ dùng tới, họ đặt mật khẩu
    // của mình qua link mời. Vẫn phải có giá trị vì cột NOT NULL, và để tài
    // khoản không đăng nhập được bằng chuỗi đoán được nào.
    const tempPassword = crypto.randomBytes(24).toString("base64url");
    const attach = await withUser(req.userId, async (c) => {
      const { rows } = await c.query(
        "select public.admin_attach_owner($1,$2,$3) as result",
        [orgId, b.owner_email.trim(), await hashPassword(tempPassword)],
      );
      return rows[0].result;
    });

    // Link mời để chủ shop tự đặt mật khẩu. Chỉ tạo cho tài khoản mới — người
    // đã có tài khoản thì đăng nhập như bình thường.
    let inviteLink = null;
    if (attach.created) {
      const { token, hash } = newRefreshToken();
      await query("select auth_create_onetime_token($1,$2,'password_reset',$3)", [
        attach.user_id,
        hash,
        new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000),
      ]);
      inviteLink = `https://ipos123.vn/reset-password?token=${token}`;

      // TODO: gửi qua SMTP khi nối được mail server. Tới lúc đó bỏ inviteLink
      // khỏi response — trả link về client là để admin copy tay trong giai đoạn
      // chưa có mail, không phải thiết kế lâu dài.
      req.log.warn(
        { email: b.owner_email, orgId },
        "chưa nối SMTP — link mời trả thẳng cho admin copy tay",
      );
    }

    return {
      org_id: orgId,
      owner_email: b.owner_email.trim(),
      owner_created: attach.created,
      invite_link: inviteLink,
    };
  });

  /** Lịch sử thanh toán của một tiệm. RLS + RPC đã gác quyền super_admin. */
  app.get("/shop/:orgId/payments", async (req) => {
    const rows = await withUser(req.userId, async (c) => {
      const { rows } = await c.query(
        `select p.* from public.subscription_payments p
         join public.subscriptions s on s.id = p.subscription_id
         where s.org_id = $1
         order by p.payment_date desc, p.created_at desc
         limit 200`,
        [req.params.orgId],
      );
      return rows;
    });
    return { data: rows };
  });
}


