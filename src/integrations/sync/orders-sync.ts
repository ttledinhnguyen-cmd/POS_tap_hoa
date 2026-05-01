import type { RealtimeChannel } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import type { CartItem, Order, OrderItem } from "@/types";
import { supabase } from "@/integrations/supabase";
import type { OutboxJob } from "@/integrations/shared/queue";

/**
 * Supabase orders row (snake_case + ISO timestamps).
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
  tax_rate: number; // percent
  line_total: number;
}

/**
 * Combined select (FK embed) khi pull orders + items 1 round-trip.
 */
type OrderRowWithItems = OrderRow & { order_items: OrderItemRow[] };

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
  private channel: RealtimeChannel | null = null;
  private subscribedOrgId: string | null = null;
  private pulledOrgs: Set<string> = new Set();

  /**
   * Pull orders + items theo since (mặc định 30 ngày gần nhất).
   */
  async pullOrders(orgId: string, sinceMs?: number): Promise<void> {
    if (!orgId) return;
    const since = new Date(sinceMs ?? Date.now() - PULL_WINDOW_MS).toISOString();
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("org_id", orgId)
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("[orders-sync] pull failed:", error.message);
      throw error;
    }
    const rows = (data ?? []) as OrderRowWithItems[];
    const orders = rows.map(orderFromRow);
    const allItems = rows.flatMap((r) =>
      (r.order_items ?? []).map((it) => itemFromRow(it)),
    );
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

  /**
   * Pull items của 1 order (dùng khi realtime UPDATE event đến mà chưa có items).
   */
  async pullOrderItems(orderId: string): Promise<void> {
    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", orderId);
    if (error) throw error;
    const rows = (data ?? []) as OrderItemRow[];
    const items = rows.map(itemFromRow);
    await db.transaction("rw", db.orderItems, async () => {
      await db.orderItems.where("orderId").equals(orderId).delete();
      if (items.length) await db.orderItems.bulkPut(items);
    });
  }

  /**
   * Subscribe realtime channel cho orders. items KHÔNG realtime, pull khi cần.
   */
  subscribeRealtime(orgId: string): void {
    if (this.subscribedOrgId === orgId) return;
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    this.subscribedOrgId = orgId;
    this.channel = supabase
      .channel(`orders:${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `org_id=eq.${orgId}`,
        },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string };
            if (old?.id) {
              await db.transaction(
                "rw",
                db.orders,
                db.orderItems,
                async () => {
                  await db.orders.delete(old.id!);
                  await db.orderItems.where("orderId").equals(old.id!).delete();
                },
              );
            }
            return;
          }
          // INSERT or UPDATE — LWW theo updated_at
          const row = payload.new as OrderRow;
          if (!row?.id) return;
          const incoming = orderFromRow(row);
          const existing = await db.orders.get(incoming.id);
          if (existing && existing.updatedAt >= incoming.updatedAt) {
            return; // local mới hơn — giữ nguyên
          }
          await db.orders.put(incoming);
          // INSERT mới → fetch items (UPDATE thường không đổi items, vẫn pull cho an toàn)
          if (payload.eventType === "INSERT") {
            this.pullOrderItems(incoming.id).catch((err) => {
              if (import.meta.env.DEV) {
                console.warn(
                  `[orders-sync] pullOrderItems(${incoming.id}) failed:`,
                  err,
                );
              }
            });
          }
        },
      )
      .subscribe();
    if (import.meta.env.DEV) {
      console.log(`[orders-sync] subscribed realtime for org ${orgId}`);
    }
  }

  unsubscribeAndReset(): void {
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    this.subscribedOrgId = null;
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
