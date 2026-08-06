# Gắn app vào domain `ipos123.vn`

> **Thực tế hạ tầng khác với HOSTING.md.** `HOSTING.md` mô tả deploy Docker +
> Caddy trên Ubuntu. Server production `103.68.68.146` thật ra là **Windows
> Server 2022 chạy IIS**, và IIS đang giữ port 80/443 để phục vụ nhiều site
> khác của bạn (`bdcbanking.com`, `laitot.com`, `themarisvip.com`, `alaw.vn`…).
>
> Không cài Docker/Caddy lên máy này — sẽ tranh port 80/443 và làm sập các
> site đang chạy. Đường deploy đúng là **IIS**, mô tả trong file này.
> `Dockerfile`/`Caddyfile`/`docker-compose.yml` giữ nguyên cho trường hợp sau
> này chuyển sang VPS Linux riêng.

## Hiện trạng

| Hạng mục | Trạng thái |
|---|---|
| DNS `ipos123.vn` → 103.68.68.146 | ✅ Đã trỏ |
| DNS `www.ipos123.vn` → 103.68.68.146 | ✅ Đã trỏ (NS: matbao.vn) |
| Nội dung site tại `D:\Hosting\_iis_sites\ipos123.vn` | ✅ Đã deploy |
| `web.config` (SPA + cache + security header) | ✅ Đã đặt |
| IIS site + binding | ⬜ **Cần Administrator** |
| Cert HTTPS Let's Encrypt | ⬜ **Cần Administrator** |
| Supabase Auth URL | ⬜ **Cần bạn vào Dashboard** |
| Goong referrer restriction | ⬜ **Cần bạn vào Dashboard** |
| Service worker (PWA / offline) | ✅ Đã fix (2026-08-06) — xem cuối file |
| Icon PWA + favicon | ✅ Đã tạo (placeholder, thay được) |

---

## 1. Deploy nội dung (đã xong, chạy lại khi có bản mới)

```powershell
cd "D:\Hosting\Hao's Projects\POS_Tap_Hoa\pos-tap-hoa"
.\deploy\deploy-iis.ps1
```

Script tự: kiểm tra `.env.local` → `npm run build` → xác nhận Supabase URL đã
inline vào bundle → robocopy `dist` sang site root → cập nhật `web.config` →
tạo `.well-known/acme-challenge`.

Chạy được bằng user thường, không cần admin. Dùng `-SkipBuild` nếu chỉ muốn
copy lại bản build hiện có.

---

## 2. Dựng IIS site — **cần Administrator**

Session Claude Code hiện chạy dưới user `hao` (không phải admin) nên không tạo
được site. Bạn mở **PowerShell bằng Run as Administrator** rồi:

```powershell
cd "D:\Hosting\Hao's Projects\POS_Tap_Hoa\pos-tap-hoa"
.\deploy\setup-iis-site.ps1
```

Script này:
- Kiểm tra URL Rewrite đã cài (có sẵn, v7.2)
- **Dừng lại nếu `ipos123.vn` hoặc `www` đang bị site khác giữ** — để không
  phá binding của các site đang chạy
- Tạo app pool `ipos123.vn` (No Managed Code — site tĩnh thuần)
- Tạo site trỏ `D:\Hosting\_iis_sites\ipos123.vn`, binding HTTP cho apex + www
- Cấp quyền đọc NTFS cho app pool identity và IUSR

Idempotent — chạy lại không hỏng gì.

---

## 3. Xin cert HTTPS — **cần Administrator**

**HTTPS là bắt buộc**: camera quét mã vạch chỉ chạy trên HTTPS. Không có cert
thì app coi như vô dụng.

Server đã có sẵn hai công cụ, chọn một:

**Cách 1 — Certify The Web** (`C:\Program Files\CertifyTheWeb`, đang quản lý
cert cho các domain khác trên máy này — nên dùng cho nhất quán):

1. Mở Certify The Web → **New Certificate**
2. Chọn site `ipos123.vn`
3. Tick cả `ipos123.vn` và `www.ipos123.vn`
4. **Request Certificate**

Tự động gia hạn, không phải làm gì thêm.

**Cách 2 — win-acme** (`C:\win-acme`):

```powershell
C:\win-acme\wacs.exe --target iissite --siteid (Get-Website -Name 'ipos123.vn').Id
```

`web.config` đã cấu hình để HTTP-01 challenge đi lọt: `.well-known/acme-challenge`
không bị redirect HTTPS, không bị SPA fallback nuốt, và có MIME cho file không
phần mở rộng.

---

## 4. Cập nhật Supabase Auth URL — **dễ quên nhất**

Project hosted đang để `site_url = http://localhost:5173`. Không đổi thì mọi
link trong email **mời chủ shop** và **reset mật khẩu** đều trỏ về localhost —
khách bấm vào không vào được app.

Supabase Dashboard (project `lidkbryncjlwqquadywn`) → Authentication →
URL Configuration:

- **Site URL**: `https://ipos123.vn`
- **Redirect URLs**: thêm `https://ipos123.vn/**` (giữ `http://localhost:5173/**` để dev)

`src/integrations/auth.ts:59` dùng `${window.location.origin}/reset-password`
nên chỉ cần allow-list origin, không phải sửa code.

---

## 5. Restrict Goong API key

Goong Dashboard → key đang dùng → HTTP Referrer restriction: `https://ipos123.vn/*`

Key nằm trong bundle, ai xem source cũng đọc được — không restrict thì người
khác xài hết 1000 request/ngày free của bạn.

---

## 6. Nghiệm thu

```powershell
curl.exe -I https://ipos123.vn          # 200, cert hợp lệ
curl.exe -I https://www.ipos123.vn      # 301 → https://ipos123.vn/
curl.exe -I http://ipos123.vn           # 301 → https://
curl.exe -I https://ipos123.vn/orders   # 200 (SPA fallback, không phải 404)
```

Trên **điện thoại thật** (Chrome Android + Safari iOS):

- [ ] Mở `https://ipos123.vn` — không cảnh báo bảo mật
- [ ] Đăng nhập tài khoản owner
- [ ] Bấm "Quét mã" → camera bật (lý do HTTPS bắt buộc)
- [ ] Quét mã vạch gói mì / chai nước → ra sản phẩm
- [ ] Thanh toán 1 đơn, kiểm tra ở trang Đơn hàng
- [ ] Gửi email mời shop mới từ trang Admin → link trỏ `ipos123.vn`, không
      phải localhost
- [ ] F5 tại `/orders` → vẫn ra trang Đơn hàng, không 404

---

## PWA — đã fix (2026-08-06)

**Trước**: `dist` build ra không có `sw.js` lẫn `manifest.webmanifest` → mất
mạng là app trắng màn hình, không "Thêm vào màn hình chính" được, không tự
cập nhật phiên bản. Với sản phẩm bán chữ "offline-first" thì đây là lỗi nặng.

**Nguyên nhân gốc**: strategy `generateSW` của workbox-build sinh template
chứa `import ... from 'D:/Hosting/Hao's Projects/.../workbox-precaching/...'`
— dấu nháy phá vỡ chuỗi JS nên build fail, và `vite.config.ts` phải tắt PWA
để build chạy được. Junction path không dấu nháy **không** cứu được
(vite-plugin-pwa resolve về realpath — đã thử).

**Đã sửa**: chuyển sang strategy `injectManifest`. Service worker do mình viết
(`src/sw.ts`), workbox chỉ thay `self.__WB_MANIFEST` bằng danh sách file nên
không nhúng đường dẫn tuyệt đối vào đâu cả. Chạy được ở mọi đường dẫn, cả
Windows lẫn Linux.

Thay đổi:
- Thêm `src/sw.ts` — skipWaiting + clientsClaim (bản mới kích hoạt ngay, POS
  mở 1 tab cả ngày nên không thể đợi đóng tab), cleanupOutdatedCaches,
  precacheAndRoute, NavigationRoute → `index.html` cho SPA fallback offline
- `vite.config.ts` — `strategies: "injectManifest"`, bỏ hẳn `disable`
- `tsconfig.json` — loại `src/sw.ts` khỏi `tsc -b` (ServiceWorkerGlobalScope
  xung khắc lib DOM); Vite vẫn bundle qua vite-plugin-pwa
- devDependencies: `workbox-core`, `workbox-precaching`, `workbox-routing` @7.4.0
- `public/` — thêm `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`,
  `favicon.svg` (trước đó manifest trỏ tới icon KHÔNG tồn tại → browser từ
  chối cho cài PWA dù có service worker)

**Đã kiểm chứng** trên `vite preview` + Chrome: service worker state
`activated`, 49 file trong `workbox-precache-v2`, console không lỗi.

### Precache có chọn lọc

`injectManifest.globIgnores` loại `goong-js-*` (bản đồ, ~784 KB kể cả CSS) và
`xlsx-*` (nhập hàng loạt, ~430 KB) khỏi precache — hai thứ này chỉ dùng khi có
mạng và không nằm trong luồng bán hàng. Precache còn **53 file / 1.3 MB** thay
vì ~2.5 MB, hợp với ràng buộc 4G/3G trong CLAUDE.md mục 3.

Hệ quả: mất mạng thì trang bản đồ admin và nhập Excel không mở được (báo lỗi
tải chunk). Bán hàng, quét mã, thanh toán, xem đơn vẫn chạy đủ. Muốn precache
tất thì xoá `globIgnores` trong `vite.config.ts`.

### Icon

Icon hiện tại là giỏ hàng trắng trên nền `#0F766E` (primary-700 trong
`tailwind.config.ts`), glyph nằm gọn trong safe zone 80% nên dùng được cho cả
`purpose: maskable`. Đây là placeholder chức năng — thay bằng cách ghi đè file
trong `public/` rồi chạy lại `deploy-iis.ps1`, không phải sửa code.

---

## Cập nhật phiên bản sau này

```powershell
cd "D:\Hosting\Hao's Projects\POS_Tap_Hoa\pos-tap-hoa"
git pull
.\deploy\deploy-iis.ps1
```

Không cần restart IIS — file tĩnh, IIS đọc trực tiếp. `web.config` đổi thì IIS
tự nạp lại app pool.

---

## Lưu ý pháp lý (VN)

- **Thông báo website TMĐT với Bộ Công Thương** (online.gov.vn) trước khi mở
  bán gói thuê bao công khai. Hiện `/signup` đang disable nên chưa gấp.
- Trang Điều khoản + Chính sách bảo mật đã có ở `/legal` (Nghị định 13/2023 về
  bảo vệ dữ liệu cá nhân). Nhớ set `VITE_BUSINESS_NAME`, `VITE_SUPPORT_EMAIL`,
  `VITE_SUPPORT_ZALO` trong `.env.local` bằng thông tin thật — hiện đang dùng
  giá trị mặc định (`support@example.com`, `0901234567`).
