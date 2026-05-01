import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Nền
        bg: {
          DEFAULT: "#FAFAF7", // trắng ấm — không lạnh, không trắng tinh
          card: "#FFFFFF",
          subtle: "#F5F4EE",
        },
        // Chính — xanh trà đậm: tin cậy, tươi mới
        primary: {
          50: "#F0FDFA",
          100: "#CCFBF1",
          500: "#14B8A6",
          600: "#0D9488",
          700: "#0F766E", // chính
          800: "#115E59",
          900: "#134E4A",
        },
        // Accent CTA — cam san hô: ấm, văn hóa Việt
        accent: {
          DEFAULT: "#E76F51",
          hover: "#D85F40",
        },
        // Chữ
        ink: {
          DEFAULT: "#1A1A1A",
          muted: "#6B6B68",
          subtle: "#9A9A95",
        },
        // Cảnh báo
        danger: {
          DEFAULT: "#DC2626",
          bg: "#FEF2F2",
        },
        // Đường viền
        line: {
          DEFAULT: "#E8E6DE",
          strong: "#D4D2C8",
        },
      },
      fontFamily: {
        sans: [
          "Be Vietnam Pro",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Số tiền — cần lớn để đọc được dưới ánh sáng mặt trời
        money: ["1.5rem", { lineHeight: "1.2", fontWeight: "600" }],
        "money-lg": ["2rem", { lineHeight: "1.1", fontWeight: "700" }],
      },
      spacing: {
        // Vùng chạm tối thiểu cho ngón tay có thể dính dầu mỡ
        touch: "48px",
        "touch-lg": "56px",
      },
      borderRadius: {
        DEFAULT: "10px",
        lg: "14px",
        xl: "20px",
      },
      boxShadow: {
        // Bóng tinh tế — không dramatic
        soft: "0 1px 2px rgba(0, 0, 0, 0.04), 0 2px 8px rgba(0, 0, 0, 0.04)",
        card: "0 1px 3px rgba(0, 0, 0, 0.06)",
        sheet: "0 -8px 32px rgba(0, 0, 0, 0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
