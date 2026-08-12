import { Poller, maxUpdatedAt } from "@/integrations/sync/poller";
import { db } from "@/lib/db";
import type { CartItem, Order, OrderItem } from "@/types";
import { api } from "@/integrations/api";
import type { OutboxJob } from "@/integrations/shared/queue";

/**
 * Hàng orders từ API (snake_case, ISO timestamp).
 */
interface OrderRow {
  id: string;
  org_id: string;
  cashier_id: string | null;
  subtotal: number;
  tax_amount: number;
  discount: number;
  total: number;
  payment_method: "cash" | "transfer" | "qr" | "mixed";
  cash_received: number | null;
  change_amount: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_tax_code: string | null;
  invoice_status: "none" | "pending" | "issued" | "failed" | "cancelled";
  invoice_no: string | null;
  invoice_lookup_code: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit: string;
  quantity: number;
  price_buy: number;
  price_sell: number;
  tax_rate: number; // phần trăm
  line_total: number;
}

function orderFromRow(row: OrderRow): Order {
  return {
    id: row.id,
    orgId: row.org_id,
    cashierId: row.cashier_id ?? undefined,
    subtotal: Number(row.subtotal),
    taxAmount: Number(row.tax_amount),
    discount: Number(row.discount),
    total: Number(row.total),
    paymentMethod: row.payment_method,
    cashReceived: row.cash_received != null ? Number(row.cash_received) : undefined,
    changeAmount: row.change_amount != null ? Number(row.change_amount) : undefined,
    customerName: row.customer_name ?? undefined,
    customerPhone: row.customer_phone ?? undefined,
    customerTaxCode: row.customer_tax_code ?? undefined,
    invoiceStatus: row.invoice_status,
    invoiceNo: row.invoice_no ?? undefined,
    invoiceLookupCode: row.invoice_lookup_code ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function itemFromRow(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id ?? undefined,
    productName: row.product_name,
    unit: row.unit,
    quantity: Number(row.quantity),
    priceBuy: Number(row.price_buy),
    priceSell: Number(row.price_sell),
    taxRate: Number(row.tax_rate) / 100, // percent → fraction (client convention)
    lineTotal: Number(row.line_total),
  };
}

/**
 * Khoảng thời gian default pull initial: 30 ngày gần nhất.
 * Long-range query (báo cáo năm) defer Phase 7+.
 */
const PULL_WINDOW_MS = 30 * 24 * 3600 * 1000;

/**
 * Input để PaymentSheet tạo order.
 */
export interface CreateOrderInput {
  orgId: string;
  paymentMethod: "cash" | "transfer" | "qr";
  cashReceived?: number;
  changeAmount?: number;
  customerName?: string;
  customerPhone?: string;
  customerTaxCode?: string;
  notes?: string;
  // Tổng tính toán từ cart trước khi gọi
  subtotal: number; // = total - taxAmount
  taxAmount: number;
  discount?: number;
  total: number;
  items: CartItem[]; // mảng từ cart store
}

class OrdersSync {
  private pulledOrgs: Set<string> = new Set();

  private poller = new Poller<OrderRow>({
    table: "orders",
    apply: (rows) => this.applyOrders(rows),
    watermarkOf: (rows) => maxUpdatedAt(rows),
  });

  /**
   * Áp đơn nhận từ server. LWW theo updated_at, và kéo thêm chi tiết cho đơn
   * chưa có dòng nào ở local (đơn do máy khác trong tiệm bán).
   */
  private async applyOrders(rows: OrderRow[]): Promise<void> {
    for (const row of rows) {
      const incoming = orderFromRow(row);
      const existing = await db.orders.get(incoming.id);
      if (existing && existing.updatedAt >= incoming.updatedAt) continue;
      await db.orders.put(incoming);
      const itemCount = await db.orderItems.where("orderId").equals(incoming.id).count();
      if (itemCount === 0) {
        await this.pullOrderItems(incoming.id).catch(() => undefined);
      }
    }
  }

  /**
   * Kéo đơn + chi tiết trong cửa sổ thời gian (mặc định 30 ngày gần nhất).
   *
   * Đơn và chi tiết lấy bằng hai lời gọi rồi ghép ở client. Bản Supabase dùng
   * join lồng `select("*, order_items(*)")`; server tự host thay bằng lọc
   * order_items theo org_id qua JOIN với orders — vẫn một request, không phải
   * một request mỗi đơn.
   */
  async pullOrders(orgId: string, sinceMs?: number): Promise<void> {
    if (!orgId) return;
    const since = new Date(sinceMs ?? Date.now() - PULL_WINDOW_MS).toISOString();

    const [orderRows, itemRows] = await Promise.all([
      api.list<OrderRow>("orders", { org_id: orgId, since_created: since }),
      api.list<OrderItemRow>("order_items", { org_id: orgId, since_parent: since }),
    ]);

    const orders = orderRows.map(orderFromRow);
    const allItems = itemRows.map(itemFromRow);
    await db.transaction("rw", db.orders, db.orderItems, async () => {
      await db.orders.bulkPut(orders);
      // Xóa items cũ của các orders vừa pull, rồi insert lại để tránh stale
      const orderIds = orders.map((o) => o.id);
      if (orderIds.length) {
        await db.orderItems.where("orderId").anyOf(orderIds).delete();
      }
      if (allItems.length) {
        await db.orderItems.bulkPut(allItems);
      }
    });
    this.pulledOrgs.add(orgId);
    if (import.meta.env.DEV) {
      console.log(
        `[orders-sync] pulled ${orders.length} orders + ${allItems.length} items for org ${orgId}`,
      );
    }
  }

  async pullOrdersIfNeeded(orgId: string): Promise<void> {
    if (this.pulledOrgs.has(orgId)) return;
    await this.pullOrders(orgId);
  }

  /** Kéo chi tiết của một đơn (khi poll thấy đơn mới mà local chưa có dòng nào). */
  async pullOrderItems(orderId: string): Promise<void> {
    const rows = await api.list<OrderItemRow>("order_items", { order_id: orderId });
    const items = rows.map(itemFromRow);
    await db.transaction("rw", db.orderItems, async () => {
      await db.orderItems.where("orderId").equals(orderId).delete();
      if (items.length) await db.orderItems.bulkPut(items);
    });
  }

  /**
   * Theo dõi đơn mới từ máy khác trong cùng tiệm. Chi tiết đơn chỉ kéo khi
   * gặp đơn chưa có dòng nào ở local (xem applyOrders).
   *
   * Đơn hàng là append-only nên poll tăng dần theo updated_at là đủ — không có
   * chuyện xoá đơn cần đồng bộ ngược.
   */
  startPolling(orgId: string): void {
    this.poller.start(orgId);
    if (import.meta.env.DEV) {
      console.log(`[orders-sync] bắt đầu poll cho org ${orgId}`);
    }
  }

  /** Kéo ngay một nhịp, dùng sau khi outbox vừa đẩy đơn lên. */
  syncNow(): Promise<void> {
    return this.poller.tick();
  }

  stopAndReset(): void {
    this.poller.stop();
    this.pulledOrgs.clear();
  }

  /**
   * Tạo order: optimistic ghi Dexie ngay (orders + orderItems) + decrement
   * Dexie products.stock + enqueue outbox 'order.create' → worker drain RPC.
   *
   * UX: PaymentSheet hiển thị "Đã thanh toán" ngay sau Promise resolve, không
   * đợi RPC server. Realtime sẽ sync lại khi server confirm.
   */
  async createOrder(input: CreateOrderInput): Promise<string> {
    const now = Date.now();
    const orderId = crypto.randomUUID();
    const order: Order = {
      id: orderId,
      orgId: input.orgId,
      subtotal: Math.round(input.subtotal),
      taxAmount: Math.round(input.taxAmount),
      discount: Math.round(input.discount ?? 0),
      total: Math.round(input.total),
      paymentMethod: input.paymentMethod,
      cashReceived: input.cashReceived,
      changeAmount: input.changeAmount,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerTaxCode: input.customerTaxCode,
      invoiceStatus: "none", // Sprint 4 sẽ trigger 'invoice.issue' khi tích hợp MISA
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };

    const orderItems: OrderItem[] = input.items.map((it) => ({
      id: crypto.randomUUID(),
      orderId,
      productId: it.productId,
      productName: it.name,
      unit: it.unit,
      quantity: it.quantity,
      priceBuy: Math.round(it.priceCost),
      priceSell: Math.round(it.priceSell),
      taxRate: it.taxRate,
      lineTotal: Math.round(it.priceSell * it.quantity),
    }));

    // Optimistic: ghi Dexie + decrement products.stock + enqueue outbox
    // Atomic transaction
    await db.transaction(
      "rw",
      db.orders,
      db.orderItems,
      db.products,
      db.outbox,
      async () => {
        await db.orders.add(order);
        if (orderItems.length) await db.orderItems.bulkAdd(orderItems);
        // Decrement Dexie stock — allow negative (bán nợ)
        for (const it of orderItems) {
          if (!it.productId) continue;
          const p = await db.products.get(it.productId);
          if (p) {
            await db.products.update(it.productId, {
              stock: p.stock - it.quantity,
              updatedAt: now,
            });
          }
        }
        // Outbox payload: convert sang snake_case + tax_rate percent (Phase 4 convention)
        const orderPayload = {
          id: order.id,
          org_id: order.orgId,
          subtotal: order.subtotal,
          tax_amount: order.taxAmount,
          discount: order.discount,
          total: order.total,
          payment_method: order.paymentMethod,
          cash_received: order.cashReceived ?? null,
          change_amount: order.changeAmount ?? null,
          customer_name: order.customerName ?? null,
          customer_phone: order.customerPhone ?? null,
          customer_tax_code: order.customerTaxCode ?? null,
          notes: order.notes ?? null,
          created_at: new Date(order.createdAt).toISOString(),
        };
        const itemsPayload = orderItems.map((it) => ({
          id: it.id,
          product_id: it.productId ?? null,
          product_name: it.productName,
          unit: it.unit,
          quantity: it.quantity,
          price_buy: it.priceBuy,
          price_sell: it.priceSell,
          tax_rate: Math.round(it.taxRate * 100), // fraction → percent
          line_total: it.lineTotal,
        }));
        const job: OutboxJob = {
          id: crypto.randomUUID(),
          type: "order.create",
          payload: { order: orderPayload, items: itemsPayload },
          attempts: 0,
          nextRunAt: now,
          createdAt: now,
        };
        await db.outbox.add(job);
      },
    );

    return orderId;
  }
}

export const ordersSync = new OrdersSync();
