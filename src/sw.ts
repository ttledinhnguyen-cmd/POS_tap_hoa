/// <reference lib="webworker" />
//
// Service worker cho Tạp Hóa POS.
//
// Dùng strategy `injectManifest` thay vì `generateSW`: generateSW sinh template
// chứa `import ... from '<đường dẫn tuyệt đối>/node_modules/workbox-*/...'`,
// mà repo nằm ở D:\Hosting\Hao's Projects\... — dấu nháy phá vỡ chuỗi JS và
// build fail. injectManifest chỉ thay `self.__WB_MANIFEST` bằng danh sách file
// nên không phụ thuộc đường dẫn. Chạy được cả Windows lẫn Linux.
//
// File này KHÔNG nằm trong `tsc -b` (xem exclude trong tsconfig.json) vì
// ServiceWorkerGlobalScope xung khắc với lib DOM của app. Vite vẫn bundle nó.

import { clientsClaim } from "workbox-core";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// registerType "autoUpdate": bản mới kích hoạt ngay thay vì đợi user đóng hết
// tab. Máy tính tiền mở 1 tab suốt ngày — đợi đóng tab thì update không bao giờ tới.
self.skipWaiting();
clientsClaim();

// Dọn cache của các bản build cũ. Tên file có hash nên cache cũ chỉ tốn chỗ.
cleanupOutdatedCaches();

// Danh sách file precache do vite-plugin-pwa chèn vào lúc build.
precacheAndRoute(self.__WB_MANIFEST);

// SPA fallback: mọi navigation (F5 tại /orders, mở link sâu) trả index.html
// cho react-router xử lý. Thiếu dòng này thì reload lúc mất mạng ra trang lỗi
// thay vì app — đúng cái tình huống offline-first cần chạy được.
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));
