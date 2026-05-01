import { create } from "zustand";
import type { CartItem, Product } from "@/types";

interface CartState {
  items: CartItem[];
  addProduct: (product: Product, quantity?: number) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  removeItem: (productId: string) => void;
  clear: () => void;

  // Computed
  subtotal: () => number;
  taxAmount: () => number;
  total: () => number;
  itemCount: () => number;
}

export const useCart = create<CartState>((set, get) => ({
  items: [],

  addProduct: (product, quantity = 1) => {
    const existing = get().items.find((i) => i.productId === product.id);
    if (existing) {
      set({
        items: get().items.map((i) =>
          i.productId === product.id
            ? { ...i, quantity: i.quantity + quantity }
            : i,
        ),
      });
    } else {
      const newItem: CartItem = {
        productId: product.id,
        barcode: product.barcode,
        name: product.name,
        unit: product.unit,
        priceSell: product.priceSell,
        priceCost: product.priceCost, // Phase 5: snapshot cho order_items.price_buy
        taxRate: product.taxRate,
        quantity,
      };
      set({ items: [...get().items, newItem] });
    }
  },

  updateQuantity: (productId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(productId);
      return;
    }
    set({
      items: get().items.map((i) =>
        i.productId === productId ? { ...i, quantity } : i,
      ),
    });
  },

  removeItem: (productId) =>
    set({ items: get().items.filter((i) => i.productId !== productId) }),

  clear: () => set({ items: [] }),

  // Giá đã bao gồm thuế => subtotal là tổng đã có thuế
  subtotal: () =>
    get().items.reduce((sum, i) => sum + i.priceSell * i.quantity, 0),

  // Tách phần thuế ra (chỉ phục vụ hiển thị / hóa đơn điện tử)
  taxAmount: () =>
    get().items.reduce((sum, i) => {
      const lineTotal = i.priceSell * i.quantity;
      const beforeTax = lineTotal / (1 + i.taxRate);
      return sum + (lineTotal - beforeTax);
    }, 0),

  total: () => get().subtotal(),

  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
}));
