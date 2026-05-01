import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Workaround: workbox-build sinh SW lỗi khi cwd chứa apostrophe (vd. "Hao's Projects").
      // Path deploy Linux không có apostrophe nên PWA tự enable bình thường.
      disable: process.cwd().includes("'"),
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Tạp Hóa POS",
        short_name: "TapHoa",
        description: "Phần mềm bán hàng tối giản cho tiệm tạp hóa",
        theme_color: "#0F766E",
        background_color: "#FAFAF7",
        display: "standalone",
        orientation: "portrait",
        lang: "vi",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    // Allow tunneling host (ngrok/cloudflare) khi demo cho chủ shop.
    // Chỉ ảnh hưởng dev server — production build serve qua Caddy không bị ràng buộc này.
    // Leading dot = subdomain wildcard.
    allowedHosts: ["majorette-blatantly-swerve.ngrok-free.dev", "localhost", ".ngrok-free.dev", ".ngrok-free.app", ".ngrok.app", ".trycloudflare.com"],
  },
  build: {
    rollupOptions: {
      output: {
        // Manual chunks: tách các vendor lớn ra khỏi initial bundle để cache hiệu quả
        // qua các deploy (vendor ít đổi hơn app code).
        // @zxing KHÔNG manual chunk — sẽ tự thành chunk riêng qua dynamic import
        // trong BarcodeScanner (load on-demand khi user click "Quét mã").
        manualChunks: {
          supabase: ["@supabase/supabase-js"],
          dexie: ["dexie", "dexie-react-hooks"],
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          zustand: ["zustand"],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
