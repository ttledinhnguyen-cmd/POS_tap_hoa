import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // `injectManifest` thay vì `generateSW`: generateSW sinh template chứa
      // `import ... from '<abs path>/node_modules/workbox-*/...'`, mà repo nằm
      // ở D:\Hosting\Hao's Projects\... — dấu nháy phá vỡ chuỗi JS → build fail
      // → bản production trước đây KHÔNG có service worker (mất offline, mất
      // "Thêm vào màn hình chính"). injectManifest chỉ thay `self.__WB_MANIFEST`
      // nên không phụ thuộc đường dẫn. ĐỪNG đổi ngược về generateSW.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
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
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          // Khai riêng maskable thay vì "any maskable" gộp — browser xử lý
          // chuỗi gộp không nhất quán. Glyph nằm trong safe zone 80%.
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Hai chunk này chỉ dùng khi CÓ mạng: goong-js là bản đồ (trang admin),
        // xlsx là nhập hàng loạt (việc setup của chủ, không phải bán hàng).
        // Precache chúng tốn thêm ~1.2 MB trên 4G/3G mà không giúp bán offline.
        // Không giới hạn .js — goong-js còn kèm ~52 KB CSS, precache riêng
        // phần CSS là vô nghĩa khi phần JS đã bị loại.
        globIgnores: ["**/goong-js-*", "**/xlsx-*"],
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
