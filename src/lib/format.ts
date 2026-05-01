/**
 * Format số thành tiền Việt: 45500 -> "45.500"
 * Không dùng toLocaleString("vi-VN") vì kết quả không nhất quán
 * giữa các trình duyệt và Android WebView.
 */
export function formatVND(amount: number): string {
  const rounded = Math.round(amount);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function formatVNDWithUnit(amount: number): string {
  return `${formatVND(amount)}đ`;
}

/**
 * Parse "45.500" hoặc "45500" -> 45500
 */
export function parseVND(input: string): number {
  const cleaned = input.replace(/[^\d]/g, "");
  return cleaned ? parseInt(cleaned, 10) : 0;
}
