import { withUser } from "../db.js";

// =============================================================================
// Bảng cho phép ĐỌC + cột được lọc
// =============================================================================
// Tên bảng và tên cột KHÔNG BAO GIỜ được ghép thẳng từ input người dùng vào SQL.
// Allowlist ở đây là hàng rào duy nhất giữa client và SQL injection ở phần
// identifier (giá trị thì đã có tham số hoá lo).
//
// RLS vẫn lọc theo org một lần nữa: client có gửi org_id của tiệm khác cũng
// nhận về rỗng. Allowlist là để chặn đọc nhầm bảng, RLS là để chặn đọc nhầm tiệm.
const READABLE = {
  products:            { filters: ["org_id", "barcode"], order: "updated_at desc" },
  categories:          { filters: ["org_id"],            order: "display_order asc" },
  orders:              { filters: ["org_id"],            order: "created_at desc" },
  goods_receipts:      { filters: ["org_id"],            order: "receipt_date desc" },
  stock_takes:         { filters: ["org_id", "id"],      order: "take_date desc" },
  suppliers:           { filters: ["org_id", "id"],      order: "name asc" },
  supplier_payments:   { filters: ["org_id", "supplier_id"], order: "payment_date desc" },
  goods_returns:       { filters: ["org_id", "supplier_id"], order: "return_date desc" },

  // Ba bảng chi tiết dưới đây cho lọc theo org_id qua JOIN với bảng cha.
  // Không có join thì client phải bắn một request cho MỖI đơn hàng khi kéo về
  // 30 ngày lịch sử — hàng trăm request trên 3G.
  // RLS vẫn gác: policy của chúng đã kiểm tra qua org_id của bảng cha.
  order_items: {
    filters: ["order_id"],
    order: null,
    parent: { table: "orders", fk: "order_id" },
  },
  goods_receipt_items: {
    filters: ["receipt_id"],
    order: null,
    parent: { table: "goods_receipts", fk: "receipt_id" },
  },
  goods_return_items: {
    filters: ["return_id"],
    order: null,
    parent: { table: "goods_returns", fk: "return_id" },
  },
  stock_take_items: {
    filters: ["stock_take_id"],
    order: null,
    parent: { table: "stock_takes", fk: "stock_take_id" },
  },
  shared_barcodes:     { filters: ["barcode"],           order: null },
  organizations:       { filters: [],                    order: "created_at asc" },
  memberships:         { filters: ["org_id"],            order: null },
  subscriptions:       { filters: ["org_id"],            order: null },
};

// Cột được phép ghi khi upsert/patch sản phẩm. Cố tình KHÔNG có created_at,
// updated_at (trigger lo) và id ở PATCH (đổi id là tạo hàng mới trá hình).
const PRODUCT_COLS = [
  "org_id", "barcode", "name", "unit", "price_buy", "price_sell",
  "stock", "tax_rate", "category", "image_url", "is_active",
];

// =============================================================================
// RPC được phép gọi
// =============================================================================
// Chỉ những function trong danh sách này gọi được qua HTTP. Thiếu allowlist thì
// client gọi được mọi function trong schema, gồm cả helper nội bộ.
//
// Mỗi function tự kiểm tra quyền bên trong (membership hoặc super_admin) nên
// đây là lớp thứ hai, không phải lớp duy nhất.
const CALLABLE_RPC = new Set([
  // Onboarding + tổ chức
  "create_organization",
  "update_organization",
  "get_org_members",
  // Bán hàng + kho
  "create_order_with_items",
  "create_goods_receipt",
  // Danh mục
  "create_category",
  "update_category",
  "delete_category",
  "reorder_categories",
  // Mã vạch dùng chung
  "contribute_barcode",
  // Kiểm kê
  "create_stock_take",
  "add_stock_take_item",
  "update_stock_take_item",
  "remove_stock_take_item",
  "commit_stock_take",
  "cancel_stock_take",
  // Quản trị SaaS
  "record_payment",
  "extend_trial",
  "suspend_shop",
  "unsuspend_shop",
  "admin_list_shops",
  "admin_dashboard_metrics",
  "admin_create_shop",
  // Nhà cung cấp, công nợ, gợi ý đặt hàng
  "upsert_supplier",
  "archive_supplier",
  "record_supplier_payment",
  "supplier_debt",
  "suggest_reorder",
  "create_goods_return",
  "set_supplier_schedule",
]);

// Thứ tự tham số phải khớp CHÍNH XÁC chữ ký function trong Postgres.
// Gọi theo tên tham số ($1 := ...) sẽ gọn hơn nhưng node-postgres không hỗ trợ,
// nên đành liệt kê. Sai thứ tự ở đây = sai dữ liệu ghi vào DB, sửa cẩn thận.
const RPC_ARGS = {
  create_organization:      ["p_name", "p_tax_code", "p_address", "p_phone"],
  update_organization:      ["p_org_id", "p_name", "p_tax_code", "p_address", "p_address_full", "p_phone", "p_latitude", "p_longitude"],
  get_org_members:          ["p_org_id"],
  create_order_with_items:  ["p_order", "p_items"],
  create_goods_receipt:     ["p_receipt", "p_items"],
  create_category:          ["p_org_id", "p_name"],
  update_category:          ["p_id", "p_new_name", "p_new_order"],
  delete_category:          ["p_id"],
  reorder_categories:       ["p_org_id", "p_ordered_ids"],
  contribute_barcode:       ["p_barcode", "p_name", "p_brand", "p_image_url", "p_default_unit"],
  create_stock_take:        ["p_org_id", "p_notes"],
  add_stock_take_item:      ["p_take_id", "p_product_id", "p_actual_count", "p_reason"],
  update_stock_take_item:   ["p_item_id", "p_actual_count", "p_reason"],
  remove_stock_take_item:   ["p_item_id"],
  commit_stock_take:        ["p_take_id"],
  cancel_stock_take:        ["p_take_id"],
  record_payment:           ["p_org_id", "p_amount", "p_period_months", "p_method", "p_notes"],
  extend_trial:             ["p_org_id", "p_new_trial_date"],
  suspend_shop:             ["p_org_id", "p_reason"],
  unsuspend_shop:           ["p_org_id"],
  admin_list_shops:         [],
  admin_dashboard_metrics:  [],
  upsert_supplier:          ["p_org_id", "p_name", "p_id", "p_phone", "p_tax_code", "p_address", "p_notes"],
  archive_supplier:         ["p_id"],
  record_supplier_payment:  ["p_supplier_id", "p_amount", "p_method", "p_notes", "p_date"],
  supplier_debt:            ["p_org_id"],
  suggest_reorder:          ["p_org_id", "p_days", "p_horizon"],
  create_goods_return:      ["p_return", "p_items"],
  set_supplier_schedule:    ["p_supplier_id", "p_weekdays", "p_rep_name", "p_rep_phone"],
  admin_create_shop:        ["p_org_name", "p_owner_email", "p_tax_code", "p_address", "p_address_full", "p_phone", "p_latitude", "p_longitude", "p_trial_days", "p_monthly_price"],
};

// jsonb phải gửi dạng chuỗi JSON, không để node-postgres tự suy kiểu — nếu để
// nó tự, mảng JS sẽ thành mảng Postgres chứ không phải jsonb và RPC lỗi kiểu.
const JSONB_ARGS = new Set(["p_order", "p_items", "p_receipt", "p_return"]);

// Function trả `returns table (...)` phải gọi bằng `select * from f(...)`.
// Gọi kiểu `select f(...)` sẽ ra một composite record bị serialize thành chuỗi
// dạng "(uuid,email,owner,...)" — client không parse được.
const SETOF_RPC = new Set(["get_org_members", "admin_list_shops", "supplier_debt", "suggest_reorder"]);

export default async function dataRoutes(app) {
  // Mọi thứ dưới đây bắt buộc đăng nhập
  app.addHook("preHandler", app.requireAuth);

  // ---------------------------------------------------------------------------
  // Đọc
  // ---------------------------------------------------------------------------
  app.get("/data/:table", async (req, reply) => {
    const { table } = req.params;
    const spec = READABLE[table];
    if (!spec) {
      return reply.code(404).send({ error: "unknown_table", message: `Không đọc được bảng '${table}'` });
    }

    const where = [];
    const params = [];
    for (const col of spec.filters) {
      const v = req.query[col];
      if (v !== undefined && v !== "") {
        params.push(v);
        where.push(`t.${col} = $${params.length}`);
      }
    }

    // Bảng chi tiết lọc theo org_id: join lên bảng cha. Tên bảng/cột lấy từ
    // allowlist ở trên, không phải từ input.
    let from = `public.${table} t`;
    if (spec.parent && req.query.org_id) {
      from = `public.${table} t join public.${spec.parent.table} p on p.id = t.${spec.parent.fk}`;
      params.push(req.query.org_id);
      where.push(`p.org_id = $${params.length}`);
      if (req.query.since_parent) {
        params.push(req.query.since_parent);
        where.push(`p.created_at >= $${params.length}`);
      }
    }

    // updated_at > since: đồng bộ tăng dần, khỏi kéo lại cả bảng mỗi nhịp poll
    if (req.query.since && ["products", "categories", "orders"].includes(table)) {
      params.push(req.query.since);
      where.push(`t.updated_at > $${params.length}`);
    }
    // orders còn lọc theo cửa sổ thời gian: chỉ giữ lịch sử gần đây ở máy bán
    if (req.query.since_created && table === "orders") {
      params.push(req.query.since_created);
      where.push(`t.created_at >= $${params.length}`);
    }

    const limit = Math.min(Number(req.query.limit) || 1000, 5000);
    const sql = [
      `select t.* from ${from}`,
      where.length ? `where ${where.join(" and ")}` : "",
      spec.order ? `order by t.${spec.order}` : "",
      `limit ${limit}`,
    ].filter(Boolean).join(" ");

    const rows = await withUser(req.userId, async (c) => (await c.query(sql, params)).rows);
    return { data: rows };
  });

  // ---------------------------------------------------------------------------
  // Ghi sản phẩm
  // ---------------------------------------------------------------------------
  // Outbox worker gọi cái này cho job product.upsert. Idempotent theo id: retry
  // sau khi mạng chập chờn sẽ UPDATE chứ không tạo hàng thứ hai.
  app.post("/data/products", async (req, reply) => {
    const body = req.body ?? {};
    if (!body.id || !body.org_id) {
      return reply.code(400).send({ error: "missing_fields", message: "Thiếu id hoặc org_id" });
    }

    const cols = ["id", ...PRODUCT_COLS.filter((c) => c in body)];
    const values = cols.map((c) => body[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const updates = cols.filter((c) => c !== "id" && c !== "org_id").map((c) => `${c} = excluded.${c}`);

    const sql = `
      insert into public.products (${cols.join(", ")})
      values (${placeholders.join(", ")})
      on conflict (id) do update set ${updates.join(", ")}
      returning *`;

    const row = await withUser(req.userId, async (c) => (await c.query(sql, values)).rows[0]);
    if (!row) {
      // RLS chặn: org_id không thuộc user này. Trả 403 chứ không phải 500.
      return reply.code(403).send({ error: "forbidden", message: "Không có quyền với tiệm này" });
    }
    return { data: row };
  });

  app.patch("/data/products/:id", async (req, reply) => {
    const body = req.body ?? {};
    const cols = PRODUCT_COLS.filter((c) => c !== "org_id" && c in body);
    if (cols.length === 0) {
      return reply.code(400).send({ error: "nothing_to_update", message: "Không có trường nào để sửa" });
    }

    const sets = cols.map((c, i) => `${c} = $${i + 1}`);
    const params = [...cols.map((c) => body[c]), req.params.id];
    const sql = `update public.products set ${sets.join(", ")} where id = $${params.length} returning *`;

    const row = await withUser(req.userId, async (c) => (await c.query(sql, params)).rows[0]);
    if (!row) {
      return reply.code(404).send({ error: "not_found", message: "Không tìm thấy sản phẩm" });
    }
    return { data: row };
  });

  // ---------------------------------------------------------------------------
  // RPC
  // ---------------------------------------------------------------------------
  app.post("/rpc/:name", async (req, reply) => {
    const { name } = req.params;
    if (!CALLABLE_RPC.has(name)) {
      return reply.code(404).send({ error: "unknown_rpc", message: `Không gọi được '${name}'` });
    }

    const argNames = RPC_ARGS[name] ?? [];
    const body = req.body ?? {};
    const params = argNames.map((a) => {
      const v = body[a];
      if (v === undefined) return null;
      return JSONB_ARGS.has(a) ? JSON.stringify(v) : v;
    });

    const casts = argNames.map((a, i) => (JSONB_ARGS.has(a) ? `$${i + 1}::jsonb` : `$${i + 1}`));
    const isSetof = SETOF_RPC.has(name);
    const sql = isSetof
      ? `select * from public.${name}(${casts.join(", ")})`
      : `select public.${name}(${casts.join(", ")}) as result`;

    const rows = await withUser(req.userId, async (c) => (await c.query(sql, params)).rows);

    // Trả mảng hàng nguyên vẹn cho function kiểu bảng, giá trị đơn cho phần còn lại.
    return { data: isSetof ? rows : (rows[0]?.result ?? null) };
  });
}
