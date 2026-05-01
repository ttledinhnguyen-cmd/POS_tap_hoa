import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useCart } from "@/stores/cart";
import { formatVND } from "@/lib/format";
import { vibrate } from "@/lib/utils";

export function Cart() {
  const items = useCart((s) => s.items);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const removeItem = useCart((s) => s.removeItem);

  if (items.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-bg-subtle flex items-center justify-center mb-4">
          <ShoppingBag className="w-7 h-7 text-ink-subtle" />
        </div>
        <p className="text-ink-muted">Chưa có món nào</p>
        <p className="text-sm text-ink-subtle mt-1">
          Quét mã vạch hoặc tìm tên ở dưới để thêm
        </p>
      </div>
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
      {items.map((item) => (
        <li
          key={item.productId}
          className="flex items-center gap-3 py-3 border-b border-line last:border-0"
        >
          <div className="flex-1 min-w-0">
            <p className="font-medium text-ink truncate">{item.name}</p>
            <p className="text-sm text-ink-muted font-mono">
              {formatVND(item.priceSell)}đ / {item.unit}
            </p>
          </div>

          <div className="flex items-center gap-1 bg-bg-subtle rounded-lg">
            <button
              onClick={() => {
                vibrate(15);
                updateQuantity(item.productId, item.quantity - 1);
              }}
              className="w-9 h-9 flex items-center justify-center press"
              aria-label="Giảm số lượng"
            >
              <Minus className="w-4 h-4" />
            </button>
            <span className="w-7 text-center font-mono font-semibold tabular-nums">
              {item.quantity}
            </span>
            <button
              onClick={() => {
                vibrate(15);
                updateQuantity(item.productId, item.quantity + 1);
              }}
              className="w-9 h-9 flex items-center justify-center press"
              aria-label="Tăng số lượng"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="w-24 text-right">
            <p className="font-mono font-semibold tabular-nums">
              {formatVND(item.priceSell * item.quantity)}đ
            </p>
          </div>

          <button
            onClick={() => removeItem(item.productId)}
            className="p-2 -mr-2 text-ink-subtle hover:text-danger press"
            aria-label="Xóa"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
