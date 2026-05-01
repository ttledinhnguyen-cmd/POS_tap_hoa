export interface Product {
  id: string;
  orgId: string; // Phase 4: scope products theo org
  barcode: string; // EAN-13, UPC, hoặc mã nội bộ
  name: string;
  unit: string; // gói, lon, chai, kg...
  priceSell: number; // giá bán (đã bao gồm thuế)
  priceCost: number; // giá vốn — chỉ chủ thấy
  stock: number;
  taxRate: number; // 0, 0.05, 0.08, 0.10 (fraction trong client; convert ×100 khi lên Supabase)
  category?: string;
  imageUrl?: string; // Sprint 7 sẽ thêm UI upload
  isActive: boolean; // soft delete: false = ngừng bán
  expiryDate?: string; // YYYY-MM-DD — client-only, không sync Supabase Phase 4
  createdAt: number;
  updatedAt: number;
}

export interface CartItem {
  productId: string;
  barcode: string;
  name: string;
  unit: string;
  priceSell: number;
  priceCost: number; // Phase 5: snapshot cho order_items.price_buy (cashier không thấy UI nhờ RoleGate)
  taxRate: number;
  quantity: number;
}

/**
 * Order metadata — items lưu ở table riêng `orderItems` (Phase 5 Dexie v4).
 */
export interface Order {
  id: string;
  orgId: string;
  cashierId?: string;
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  paymentMethod: "cash" | "transfer" | "qr" | "mixed";
  cashReceived?: number;
  changeAmount?: number;
  customerName?: string;
  customerPhone?: string;
  customerTaxCode?: string;
  invoiceStatus: "none" | "pending" | "issued" | "failed" | "cancelled";
  invoiceNo?: string;
  invoiceLookupCode?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * OrderItem — Dexie table riêng (mirror Supabase order_items).
 */
export interface OrderItem {
  id: string;
  orderId: string;
  productId?: string; // nullable — sản phẩm có thể bị xóa sau
  productName: string; // snapshot
  unit: string;
  quantity: number;
  priceBuy: number; // snapshot
  priceSell: number; // snapshot
  taxRate: number; // fraction (vd. 0.08); convert ×100 khi lên Supabase
  lineTotal: number;
}

export type Role = "cashier" | "owner";

/**
 * Phiếu nhập kho (goods receipt) — header.
 * Items lưu ở table riêng `goodsReceiptItems` (Dexie v5).
 */
export interface GoodsReceipt {
  id: string;
  orgId: string;
  receiverId?: string; // user nhập (auth.users.id)
  supplierName?: string;
  supplierPhone?: string;
  supplierTaxCode?: string;
  receiptDate: string; // YYYY-MM-DD (date type Postgres)
  invoiceNo?: string;
  totalCost: number; // tổng tiền nhập (đồng)
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface GoodsReceiptItem {
  id: string;
  receiptId: string;
  productId?: string;
  productName: string;
  unit: string;
  quantity: number;
  priceBuy: number; // giá nhập đơn vị (đồng)
  lineTotal: number; // priceBuy * quantity
}

/**
 * Input cho UI form Nhập kho — chưa có id/timestamps/totalCost (auto-calc).
 */
export interface ReceiveInput {
  supplierName?: string;
  supplierPhone?: string;
  supplierTaxCode?: string;
  receiptDate: string; // YYYY-MM-DD
  invoiceNo?: string;
  notes?: string;
}

/**
 * Item trong UI form trước khi gửi: giữ snapshot tên + đơn vị + currentStock
 * (để hiển thị "Tồn cũ X → +Y = Z"). currentStock không được sync lên Supabase.
 */
export interface ReceiveItemInput {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  priceBuy: number;
  currentStock: number; // chỉ dùng UI hiển thị, không gửi server
}
