# CLAUDE.md — Context cho Claude Code

> File này được Claude Code đọc tự động khi mở project. Nội dung dưới đây tóm tắt
> mọi quyết định kiến trúc, thiết kế, và bối cảnh kinh doanh để Claude Code có
> thể tiếp tục code đúng hướng mà không cần lặp lại các quyết định đã chốt.

## 1. Sản phẩm là gì

POS web cho **tiệm tạp hóa Việt Nam** quy mô nhỏ (1–3 nhân viên). Khác biệt
chính so với KiotViet, Sapo, MISA: **mobile-first thật sự**, **tối giản**, và
**chỉ phục vụ tạp hóa** thay vì nhồi nhét 15 ngành.

Người dùng mục tiêu: chủ và thu ngân tuổi 30–60, dùng điện thoại Android giá
trung hoặc thiết bị POS cầm tay (Sunmi V2s là device chủ lực giai đoạn 2).

## 2. Bối cảnh pháp lý — quyết định kiến trúc

Từ **01/01/2026** (Nghị định 70/2025/NĐ-CP, Thông tư 32/2025, Nghị định
141/2026/NĐ-CP):

- Hộ kinh doanh doanh thu > 1 tỷ/năm bắt buộc dùng **hóa đơn điện tử khởi tạo
  từ máy tính tiền có kết nối dữ liệu cơ quan thuế**.
- Phần mềm này về bản chất phải đóng vai trò "máy tính tiền" theo định nghĩa
  pháp luật.
- Chính sách giảm thuế GTGT 10% → 8% kéo dài đến hết 31/12/2026 theo Nghị quyết
  204/2025/QH15. Field `taxRate` trên Product để mở.
- **KHÔNG tự xây phát hành hóa đơn từ đầu**. Tích hợp qua nhà cung cấp đã được
  Tổng cục Thuế cấp phép — ưu tiên MISA meInvoice hoặc VNPT Invoice. Sẽ thêm ở
  Giai đoạn 2.

## 3. Stack đã chốt

- **Framework**: Vite + React 18 + TypeScript (KHÔNG dùng Next.js — POS là SPA
  stateful, không cần SSR; Vite build nhanh, mental model đơn giản)
- **Styling**: Tailwind CSS với design tokens trong `tailwind.config.ts`
- **State**: Zustand (client), TanStack Query (server — sẽ thêm), Dexie
  (IndexedDB cho offline)
- **Routing**: react-router-dom v6
- **Icons**: lucide-react (1 stroke-width nhất quán, KHÔNG trộn với bộ khác)
- **Quét mã vạch**: @zxing/browser cho web; sẽ thêm Capacitor + Sunmi/iMin SDK
  cho thiết bị cầm tay ở Giai đoạn 2
- **PWA**: vite-plugin-pwa
- **Backend (sẽ thêm)**: Supabase — Postgres + auth + realtime + storage,
  region Singapore. Có thể tự host về sau.

### Quy tắc khi thêm dependency

- Bundle size là vấn đề (chạy trên 4G/3G). Trước khi thêm package, cân nhắc
  viết tay nếu < 50 dòng code.
- KHÔNG thêm UI library nặng (Material UI, Chakra). Tự build component theo
  pattern shadcn.
- KHÔNG thêm date library trừ khi thật cần — Intl.DateTimeFormat đủ dùng.

## 4. Design system

Đã chốt trong `tailwind.config.ts`. Tóm tắt:

| Token | Giá trị | Dùng cho |
|---|---|---|
| `bg` | `#FAFAF7` | Nền chính (trắng ấm, không lạnh) |
| `bg-card` | `#FFFFFF` | Card, sheet |
| `primary-700` | `#0F766E` | Nút chính, accent thương hiệu |
| `accent` | `#E76F51` | CTA quan trọng (Thanh toán) |
| `ink` | `#1A1A1A` | Chữ chính |
| `ink-muted` | `#6B6B68` | Chữ phụ |
| `danger` | `#DC2626` | Cảnh báo, lỗi |
| `line` | `#E8E6DE` | Đường viền |

### Typography

- **Be Vietnam Pro**: UI chính (do người Việt thiết kế, dấu chuẩn). KHÔNG dùng
  Inter hay Roboto.
- **JetBrains Mono**: số tiền, mã vạch, mã sản phẩm. Bắt buộc `tabular-nums`
  cho số tiền để các số thẳng cột.
- Min font-size: 16px (tránh iOS auto-zoom). Số tiền 24–32px.

### Touch & spacing

- Vùng chạm tối thiểu **48×48px** (lớn hơn chuẩn iOS 44px vì tay người làm
  hàng có thể dính dầu/ướt). Class: `h-touch`, `w-touch`.
- CTA chính (Thanh toán, Quét) đặt **nửa dưới màn hình** trong vùng ngón cái.
  KHÔNG đặt ở header. Đây là điểm khác biệt cơ bản so với KiotViet/Sapo.
- Lưới 8px. Padding card tối thiểu 16px.

### Phản hồi

- Mọi nút có `press` class → scale-[0.97] khi nhấn.
- Quét mã thành công: `beep()` + `vibrate(40)` (xem `lib/utils.ts`).
- Thanh toán xong: `vibrate([60,40,60])` + animation tick xanh.

### Aesthetic

Tối giản tinh tế, không hi-tech sáo rỗng. Tránh:
- Gradient tím-xanh kiểu SaaS chung chung
- Icon dày đặc không kèm chữ
- Glassmorphism / heavy shadow
- Skeuomorphism

Tham khảo: Square POS, Toast POS, Linear, Notion (mobile), Momo Business.

## 5. Cấu trúc thư mục

```
src/
├── main.tsx              # Entry
├── App.tsx               # Routing + bottom nav
├── types.ts              # Type definitions cốt lõi
├── pages/
│   ├── POSPage.tsx       # ⭐ Màn hình bán hàng — quan trọng nhất
│   ├── ProductsPage.tsx  # Quản lý kho (placeholder)
│   └── ReportsPage.tsx   # Báo cáo (placeholder)
├── components/
│   ├── BarcodeScanner.tsx  # Camera scan, full-screen
│   ├── ProductSearch.tsx   # Tìm theo tên/mã
│   ├── Cart.tsx            # Danh sách giỏ
│   ├── PaymentSheet.tsx    # Bottom sheet thanh toán
│   └── ui/
│       ├── Button.tsx      # Nút với variants
│       └── Sheet.tsx       # Bottom sheet
├── lib/
│   ├── db.ts             # Dexie wrapper (IndexedDB)
│   ├── seed.ts           # Sản phẩm mẫu (12 mặt hàng VN thật)
│   ├── format.ts         # formatVND, parseVND
│   └── utils.ts          # cn, beep, vibrate, uid
├── stores/
│   └── cart.ts           # Zustand cho giỏ hàng
└── styles/
    └── globals.css
```

## 6. Conventions

### Naming
- File component: `PascalCase.tsx`
- File util/hook/store: `camelCase.ts`
- Type: `PascalCase` (interface > type khi có thể extend)

### Tiếng Việt
- **Toàn bộ UI text bằng tiếng Việt**, có dấu đầy đủ.
- Comment code có thể tiếng Việt hoặc Anh — chọn một và nhất quán trong file.
- Tên biến luôn tiếng Anh.
- Format số tiền: dùng `formatVND()` từ `lib/format.ts`. KHÔNG dùng
  `toLocaleString('vi-VN')` vì kết quả không nhất quán giữa các browser.

### Tiền tệ
- Lưu **VND nguyên (đơn vị đồng)**, kiểu `number`. KHÔNG dùng float vì sẽ
  có lỗi 0.1 + 0.2.
- Giá hiển thị đã bao gồm thuế. `taxAmount` chỉ tính ra để in hóa đơn.
- Làm tròn cuối cùng bằng `Math.round()` ở chỗ format.

### Offline-first
- Mọi thao tác bán hàng phải **chạy được khi mất mạng**.
- Đơn hàng mới luôn ghi vào IndexedDB trước, đồng bộ lên server sau (sẽ
  implement queue ở Giai đoạn 2).
- Không bao giờ chặn UI vì lỗi network.

### Hai chế độ user
- **Cashier**: chỉ thấy giá bán, KHÔNG thấy giá vốn, KHÔNG thấy lãi.
- **Owner**: thấy tất cả.
- Khi build trang Sản phẩm/Báo cáo, dùng hook `useRole()` (sẽ tạo) để gate.

## 7. Roadmap

### Giai đoạn 1 — MVP (đang ở đây)
- [x] Skeleton project
- [x] Màn hình bán hàng với scan + tìm + thanh toán
- [x] Lưu offline IndexedDB
- [ ] Trang Sản phẩm: thêm/sửa/xóa, scan để thêm
- [ ] Trang Báo cáo: doanh thu ngày/tuần/tháng, top sản phẩm
- [ ] Đăng nhập + role guard (cashier/owner)
- [ ] Backend Supabase + đồng bộ
- [ ] In hóa đơn nhiệt 58mm qua Bluetooth (escpos-buffer)
- [x] PWA install + icon đầy đủ (injectManifest + icon 192/512/apple-touch,
      2026-08-06 — icon hiện là placeholder theo design token, thay được)

### Giai đoạn 2 — Tuân thủ thuế
- [ ] Tích hợp HĐĐT từ máy tính tiền (MISA meInvoice API)
- [ ] Ghép VietQR động cho thanh toán chuyển khoản
- [ ] Xuất báo cáo gợi ý tờ khai thuế GTGT/TNCN theo quý

### Giai đoạn 3 — Thiết bị cầm tay
- [ ] Capacitor wrapper → APK
- [ ] Plugin native cho Sunmi: máy in tích hợp, đầu đọc laser
- [ ] Plugin tương tự cho iMin

### Giai đoạn 4 — Mở rộng
- [ ] Multi-store
- [ ] Database mã vạch dùng chung (network effect)
- [ ] App "Chủ" riêng để xem báo cáo từ xa
- [ ] Nhập hàng bằng giọng nói (Web Speech API)

## 8. Khi sửa code, cần nhớ

- **Đừng phá UX màn hình bán hàng**. Đây là 95% thời gian sử dụng. Bất kỳ thay
  đổi nào phải pass test: chủ shop 50+ tuổi tìm thấy nút Quét/Thanh toán trong
  < 1 giây.
- **Không thêm popup/modal toast cho hành động thường xuyên**. Dùng haptic +
  beep + thay đổi UI inline thay thế.
- **Tránh skeleton loader dài**. Với lượng data nhỏ của tạp hóa, chỉ cần
  spinner 200ms hoặc không cần.
- **Test trên Chrome Android thật**, không chỉ DevTools mobile emulator.
  iOS Safari có nhiều quirk với camera và viewport.

## 9. Cạnh tranh

- **KiotViet**: ~300k user, mạnh nhất nhưng giao diện mobile yếu, "overkill"
  cho tiệm nhỏ. Tham khảo các tính năng cốt lõi nhưng KHÔNG copy UI.
- **Sapo**: ~230k user, UI hiện đại nhất nhóm, mạnh đa kênh. KHÔNG cạnh tranh
  về đa kênh — đó là sân của họ.
- **MISA eShop**: mạnh về kế toán/thuế, UI phức tạp như ERP. Họ là đối tác
  tiềm năng (qua MISA meInvoice) hơn là đối thủ trực tiếp.

Định vị: **rẻ hơn, tối giản hơn, mobile-first, support qua Zalo nhanh**.

## 10. Không làm những thứ này

- Không thêm Shopee/Lazada/TikTok integration ở MVP — tạp hóa truyền thống ít
  bán đa kênh, đó là sân của Sapo.
- Không xây website builder, blog, CRM phức tạp.
- Không AI chatbot khách hàng.
- Không support đặt phòng, đặt bàn, gọi món — đó là FnB/khách sạn, không
  phải tạp hóa.
- Không hợp đồng dài hạn ép user. Trial → trả tháng → hủy bất cứ lúc nào.

## 11. Hosting & deployment

**Domain production: `ipos123.vn`** (mua 2026-08-06, NS matbao.vn). DNS apex +
www đã trỏ về `103.68.68.146`. `www` → 301 về apex: **KHÔNG chạy 2 origin** vì
IndexedDB tách theo origin, user vào lúc www lúc apex sẽ thấy đơn hàng offline
"biến mất".

### Hạ tầng THẬT — khác với mô tả Docker/Caddy bên dưới

`103.68.68.146` là **Windows Server 2022 + IIS**, không phải Ubuntu. Đây cũng
chính là máy đang chứa repo này (`D:\Hosting\Hao's Projects\...`) — dev và
production cùng một máy. IIS đang giữ port 80/443 để phục vụ nhiều site khác
(`bdcbanking.com`, `laitot.com`, `themarisvip.com`, `alaw.vn`…).

**KHÔNG cài Docker/Caddy lên máy này** — sẽ tranh port 80/443 và làm sập các
site đang chạy. Đường deploy đúng:

- Site root: `D:\Hosting\_iis_sites\ipos123.vn` (theo quy ước sẵn có của server)
- `deploy/web.config` — bản dịch Caddyfile sang IIS: SPA fallback, cache rules,
  security headers, MIME `.webmanifest`, ACME challenge passthrough
- `deploy/deploy-iis.ps1` — build + robocopy, chạy bằng user thường
- `deploy/setup-iis-site.ps1` — tạo site/binding, **cần Administrator**, chạy 1 lần
- Cert: Certify The Web (GUI, đang quản lý cert các domain khác) hoặc `C:\win-acme`

Checklist đầy đủ + trạng thái từng bước: `docs/DOMAIN_SETUP.md`.

`Dockerfile` / `Caddyfile` / `docker-compose.yml` / `HOSTING.md` giữ nguyên
(đã cập nhật domain) cho trường hợp sau này tách sang VPS Linux riêng — hiện
KHÔNG dùng.

### Stack Docker/Caddy (chưa dùng — dành cho VPS Linux tương lai)

Self-host trên VPS. Stack đã chốt:

- **Caddy 2** làm reverse proxy + serve static. Tự động Let's Encrypt cert.
- **Docker** để đóng gói. `Dockerfile` multi-stage (builder node:20-alpine →
  runtime caddy:2-alpine).
- **docker-compose.yml** có sẵn, expose 80/443/443UDP (HTTP/3).
- File cấu hình:
  - `Caddyfile` — SPA fallback, cache strategy, security headers, www redirect
  - `deploy/nginx.conf` — alternative cho ai dùng nginx có sẵn
  - `.env.example` — template cho `VITE_*` (build) + `DOMAIN`/`ACME_EMAIL`

Deploy 1 dòng: `docker compose up -d --build`. Update: `./deploy/deploy.sh`.

**Biến `VITE_*` là BUILD-TIME, không phải runtime.** `.dockerignore` loại
`.env`/`.env.local` (đúng), nên Dockerfile nhận chúng qua `ARG` và
docker-compose truyền vào qua `build.args` đọc từ `.env` trên server. Đổi giá
trị → phải `--build` lại, `docker compose restart` KHÔNG có tác dụng. Dockerfile
fail sớm nếu thiếu `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` — trước đây
build vẫn pass nhưng ra app trắng màn hình (supabase.ts throw lúc import).

**HTTPS là bắt buộc** vì camera API yêu cầu. Khi sửa hosting, không bao giờ
release config HTTP-only.

Cache rules trong Caddyfile (đừng đổi mà không hiểu hậu quả):
- `/assets/*` → cache 1 năm immutable (Vite hash filename, an toàn)
- `sw.js`, `registerSW.js`, `workbox-*.js` → no-cache (PWA cần fresh để
  user nhận update)
- `index.html` → no-cache
- Manifest, icon → cache 1 ngày

Chi tiết hướng dẫn deploy ở `HOSTING.md`.

---

## QUAN TRỌNG — Đọc trước khi code (cập nhật 2026-04-30)

Project đã sang giai đoạn lập kế hoạch tích hợp API. **Trước khi viết bất kỳ
code nào** ở session này, đọc theo thứ tự:

1. **`docs/API_INTEGRATION_SPEC.md`** — tài liệu chính ~71KB, 10 sections.
   Chứa toàn bộ spec tích hợp: Supabase schema, MISA meInvoice, SePay webhook,
   VietQR, eSMS OTP, Zalo ZNS, FPT.AI OCR, GHN/Ahamove, FCM push, Web Bluetooth
   in nhiệt, AI summary. Có sẵn TypeScript adapter, env vars, sprint plan,
   checklist devops, lưu ý pháp lý VN 2026.

2. **`docs/SESSION_HANDOFF.pdf`** — context handoff từ session trước (phân
   tích đối thủ, định vị khác biệt, design tokens, hosting decisions).

### Quy tắc làm việc

- **KHÔNG bắt đầu code mà chưa hỏi chủ shop xác nhận sprint hiện tại.** Spec
  chia 9 sprints (section 6 của `API_INTEGRATION_SPEC.md`). Mỗi sprint xong
  mới sang sprint sau.

- **Sprint 1 trước nhất**: setup Supabase project + migrations + RLS + auth.
  Code POS hiện tại chưa kết nối Supabase — phải migrate Dexie/IndexedDB sang
  pattern offline-first sync với Supabase. Chi tiết section 1.1, 1.2 trong spec.

- **Adapter pattern BẮT BUỘC**: mọi tích hợp wrap qua interface chung trong
  `src/integrations/<vendor>/`. Lý do: dễ swap nhà cung cấp HĐĐT/SMS/Shipping
  khi cần. Cấu trúc thư mục đề xuất ở section 9 của spec.

- **Secrets không bao giờ ở client**: MISA, SePay, eSMS, Zalo ZNS, FPT.AI,
  GHN, Anthropic API — gọi qua Supabase Edge Functions. Decision grid ở
  section 5 của spec liệt kê rõ cái nào browser, cái nào Edge.

- **Báo cáo trước mỗi sprint**: liệt kê các file sẽ tạo/sửa, dependencies sẽ
  cài, migrations sẽ apply. Chờ chủ shop OK rồi mới code.

### Nhiệm vụ đầu tiên khi mở session

```
Đọc docs/API_INTEGRATION_SPEC.md và docs/SESSION_HANDOFF.pdf.

Trước khi code, tóm tắt cho tôi:
1. Hiểu sprint plan section 6 — Sprint 1 cụ thể cần làm gì
2. Liệt kê các file/migration sẽ tạo trong Sprint 1
3. Có gì trong spec chưa rõ hoặc bạn không đồng ý

Sau khi tôi confirm, bắt đầu Sprint 1 (Supabase backend nền tảng).
```

---

## Sprint 1 — Đã xong (2026-04-30)

Migrations applied lên project Supabase `lidkbryncjlwqquadywn` (Singapore, PG17):
- `0001_init.sql` — 7 tables (organizations, memberships, products, orders,
  order_items, webhook_events, outbox), 6 indexes, 2 moddatetime triggers
- `0002_rls.sql` — `user_org_ids()` helper + 11 RLS policies
- `0003_fixes.sql` — unique partial indexes (org+barcode, org+invoice_no),
  tax_rate check (0|5|8|10), `orders.updated_at` + trigger,
  RPC `create_organization()` security-definer (fix onboarding RLS deadlock)

Code added trong `src/`:
- `integrations/supabase.ts` — client singleton
- `integrations/shared/{errors,http,queue}.ts` — IntegrationError class,
  fetch wrapper với timeout/retry/backoff, OutboxJob types
- `lib/db.ts` — Dexie v2 thêm `outbox` table
- `vite-env.d.ts` — types cho `import.meta.env`

### Lessons learned (đừng lặp lại)

1. **Test trigger `moddatetime` PHẢI chạy ở 2 transaction riêng**.
   `now()`/`current_timestamp` (mà `extensions.moddatetime` dùng) trả về
   **transaction start time**, fixed trong cả DO block / single query.
   `pg_sleep(1)` chỉ delay wall-clock, KHÔNG advance `now()`.
   → Test 0003-D nguyên bản (DO block 1-shot) sẽ luôn fail dù trigger đúng.
   Phải INSERT ở call 1 → wait wall-clock → UPDATE ở call 2 mới thấy `updated_at`
   advance. Trong production code (mỗi mutation client = 1 transaction riêng)
   trigger hoạt động đúng. Dùng pattern này khi viết smoke test sau.

2. **Supabase CLI không được install global qua npm**. Phải:
   - Scoop / brew / apt / direct binary, HOẶC
   - `npm install --save-dev supabase` rồi gọi qua `npx supabase ...`
   (cách thứ 2 đang dùng cho project này)

3. **`config.toml` v2.96 không nhận `verify_jwt` ở top level `[functions]`**.
   Phải declare per-function: `[functions.<name>]\nverify_jwt = false`.

4. **PWA workbox-build có bug với path chứa apostrophe** — ĐÃ FIX 2026-08-06.
   ~~Workaround `disable: process.cwd().includes("'")`~~ và ~~"deploy Linux
   không ảnh hưởng"~~ đều SAI: production build ngay trên Windows server tại
   `D:\Hosting\Hao's Projects\...` nên bản live suốt thời gian đó **không có
   `sw.js`** → mất offline, mất "Thêm vào màn hình chính", mất auto-update.
   Junction path không dấu nháy KHÔNG cứu được (vite-plugin-pwa resolve
   realpath). Fix: chuyển sang strategy **`injectManifest`** + `src/sw.ts` tự
   viết. **ĐỪNG đổi ngược về `generateSW`** — lỗi sẽ quay lại và im lặng
   (build vẫn pass nếu ai đó thêm lại `disable`). Chi tiết ở
   `docs/DOMAIN_SETUP.md` mục "PWA — đã fix".

5. **Access token Supabase (`sbp_*`) dùng được cho `supabase login --token`**,
   sau đó các lệnh CLI (`db push`, `db query --linked`, `link`) chạy
   non-interactive. Ưu tiên cách này khi automation.

6. **File `.ps1` có tiếng Việt BẮT BUỘC lưu UTF-8 CÓ BOM.** Windows PowerShell
   5.1 (cửa sổ "Run as Administrator" mặc định của Windows) đọc `.ps1` không
   BOM theo ANSI → `—` thành `â€"`, mà chuỗi đó chứa dấu `"` nên cắt đứt string
   literal → `Unexpected token`. PowerShell 7 (`pwsh`) mặc định UTF-8 nên
   **không lộ lỗi khi test** — phải parse-check bằng `powershell.exe` mới thấy:
   ```powershell
   powershell.exe -NoProfile -Command "[void][System.Management.Automation.Language.Parser]::ParseFile('<file>',[ref]$null,[ref]$e); $e"
   ```
   Chỉ áp dụng cho `.ps1`. File `.sh` (`deploy-prod.sh`) thì **KHÔNG** được có
   BOM — bash sẽ vỡ.

## Sprint 2 decisions chốt (2026-04-30)

Q1: Login = email/password + reset qua email. Magic-link/OTP defer.
Q2: Onboarding wizard 1 step — chỉ tên tiệm bắt buộc.
Q3: Multi-org switcher có ngay; ẩn nếu user chỉ thuộc 1 org.
Q4: Sync — orders **append-only** (không LWW); products metadata **LWW theo
updated_at**; **stock delta** sync qua atomic SQL `stock = stock - quantity`
(KHÔNG LWW vì 2 thiết bị bán cùng lúc).
Q5: Outbox = **browser worker only** (drain on `online` event +
`visibilitychange` + interval 30s). Cron Edge Function defer Sprint 4-5.

---

## TRẠNG THÁI HIỆN TẠI (cập nhật mỗi cuối phase)

**Sprint 2 — APPROVED hoàn tất** (5 phases done, Polish task done).

**Polish task (sau Sprint 2)** — APPROVED:
- Code-split: initial bundle 169 KB gzip (giảm 40% từ 279 KB)
- BarcodeScanner lazy chunk 109 KB chỉ tải khi click "Quét mã"
- Auth pages mỗi page < 2 KB lazy
- DEV seed sync fix qua productsSync.upsertProduct + drainNow loop

**Hướng 1 — User-facing features** (đang làm):
- Phase 1A — Order History page — APPROVED
- Phase 1B — Settings page — đang prep/code
- Phase 1C — Bulk import sản phẩm — chưa bắt đầu

**Đã treo / chưa quyết** (chờ chủ shop):
- Sprint 3 Payment (SePay + VietQR) — đang nghĩ chiến lược multi-tenant payment (BYOC vs partner deal vs build own)
- Sprint 4 MISA HĐĐT — chưa đăng ký dev account
- Sprint 5 In nhiệt Bluetooth — chưa quyết mua hardware

**Migrations đã apply (Supabase project lidkbryncjlwqquadywn):**
- `0001_init.sql` — 7 tables + indexes + moddatetime triggers
- `0002_rls.sql` — user_org_ids() + 11 policies
- `0003_fixes.sql` — unique constraints, tax_rate check, orders.updated_at, RPC create_organization
- `0004_fix_rls_recursion.sql` — fix memberships RLS recursion
- `0005_realtime_products.sql` — publication += products
- `0006_orders_sync.sql` — publication += orders, RPC create_order_with_items idempotent

**Next migration sẽ là:** `0007_get_org_members.sql` (RPC list members trong org cho Settings page)

**Tech debt nhỏ chưa fix:**
- Multi-tab outbox race (idempotent upsert mitigates, defer)
- switchOrg console-direct UI không re-render (real path OK, defer)
- Failed permanent outbox jobs không có UI retry (Phase 7+)
- Image upload Storage bucket (Sprint 7)

---

## Sprint Admin SaaS — Đã xong (2026-05-01)

Multi-tenant B2B infrastructure cho phép founder quản lý subscriptions của các tiệm khách.

**Migration 0010_subscriptions_admin.sql:**
- 3 tables: `subscriptions` (UNIQUE org_id), `subscription_payments`, `super_admins`
- Geocoding columns trên organizations: `latitude/longitude/address_full` (cho map feature defer chờ Goong key)
- 10 RPCs SECURITY DEFINER: `is_super_admin`, `record_payment`, `extend_trial`, `suspend_shop`, `unsuspend_shop`, `admin_list_shops`, `admin_dashboard_metrics`, `admin_create_shop`, `bootstrap_super_admin`, `update_organization`
- RLS dùng EXISTS subquery trực tiếp (KHÔNG dùng `user_org_ids()` để tránh recursion)

**Edge Function `admin-create-shop`** deployed:
- Verify caller is super_admin → call admin_create_shop RPC → invite owner email qua `auth.admin.inviteUserByEmail` → insert membership với service_role
- Endpoint: `https://lidkbryncjlwqquadywn.supabase.co/functions/v1/admin-create-shop`

**Frontend code:**
- `auth.ts`: `isSuperAdmin` + `currentSubscription` state, `loadAdminContext()` action
- `AuthGuard.tsx`: subscription expired/suspended gate với allow-list (`/reports`, `/settings`, `/orders`, `/admin/*`, `/subscription-expired`); super_admin BYPASS
- `AdminGuard.tsx`: wrap admin routes (chỉ super_admin)
- 5 pages mới: AdminDashboard, AdminShops, AdminShopDetail, AdminShopNew, SubscriptionExpired
- Sidebar: section "QUẢN TRỊ" conditional render khi isSuperAdmin
- /signup public DISABLE — render notice page với contact info qua `VITE_SUPPORT_ZALO` + `VITE_SUPPORT_EMAIL` env

**Bootstrap super_admin (chỉ làm 1 lần):**
```sql
-- Cách 1 (khuyến nghị): SQL Editor Dashboard
INSERT INTO super_admins (user_id)
VALUES ((SELECT id FROM auth.users WHERE email = 'founder@example.com'));

-- Cách 2: Sau khi đăng nhập, gọi RPC qua console:
-- await supabase.rpc('bootstrap_super_admin', { p_email: 'founder@example.com' })
-- RPC tự lock sau lần đầu (super_admins table có row → reject).
```

**Existing orgs backfill:** đã insert default trial 90 ngày cho 3 orgs đã có
trước khi migration push (Tiệm P1C, etc.). Nếu cần extend, gọi `extend_trial`.

**Decisions baked:**
- 1 tier 'standard' default 199.000đ/tháng, 'pro' tier schema-only (UI defer)
- Trial flexible per shop (admin set qua extend_trial)
- /signup public DISABLE — chỉ admin tạo shop hộ khách
- Suspend KHÔNG tự động unsuspend khi paid (admin manual)
- Expired access allow-list: `/reports`, `/settings`, `/orders`, `/admin/*`, `/subscription-expired`
- Email invite qua Supabase built-in (không build custom)
- Bootstrap admin: SQL manual sau migration

**Tech debt mới:**
- Map feature (AddressAutocomplete + ShopsMap) defer chờ Goong key (schema sẵn lat/lng)
- Audit log cho admin actions: defer Phase 2
- "Login as" impersonate: defer Phase 3 (security risk)
- Multi-tier UI (Pro 399k): schema sẵn, UI defer
- Charts (revenue line chart): dùng text simple, recharts defer
- MFA cho super_admin (xem revenue all shops): defer Phase 2
- Banner "trial < 7 ngày" trong app: defer Phase 2
- Terms of service + Privacy policy (Nghị định 13/2023 PDP) trước khi launch public

**Env vars optional:**
- `VITE_SUPPORT_ZALO` — số Zalo support (default `0901234567`)
- `VITE_SUPPORT_EMAIL` — email support (default `support@taphoa.app`)

---

## QUY TRÌNH GIT (sau mỗi phase)

**Repo URL**: https://github.com/ttledinhnguyen-cmd/POS_tap_hoa.git

**Sau mỗi phase APPROVED, commit + push:**
```bash
git add .
git commit -m "Phase X: mô tả ngắn gọn"
git push
```

**Pull latest từ máy khác (vd. Mac chủ shop kéo từ Win dev):**
```bash
git pull
```

**Nếu lỡ commit secret** (.env.local, API key, JWT, password trong code):
```bash
git rm --cached <file>
git commit -m "Remove secret <file>"
git push
```
→ Sau đó **ROTATE secret ngay**: Supabase Dashboard regenerate anon key, MISA app secret reset, eSMS API key recreate, etc. KHÔNG dựa vào git history rewrite (`git filter-branch` / `git filter-repo`) — giả định mọi commit đã push đều public.

**Branch policy**: chỉ `main`, solo dev không cần feature branches. Khi onboard dev thứ 2 mới chia branch.

**Files BẮT BUỘC trong .gitignore** (đã setup sẵn — verify khi clone máy mới):
- `.env`, `.env.local`, `.env.*.local` — secret env
- `node_modules/`, `dist/` — build artifacts
- `*.tsbuildinfo`, `vite.config.{d.ts,js}` — TypeScript composite project cache
- `supabase/.temp/` — Supabase CLI cache (chứa project ref + owner email PII)

**Auth Git**: dùng Git Credential Manager (GCM) đi kèm Git for Windows. Lần `git push` đầu sẽ mở browser popup để OAuth GitHub. Token cached trong Windows Credential Manager — không cần PAT thủ công.

**Note về GCM trong terminal non-TTY**: nếu `git push` chạy từ Bash script / Claude Code subprocess, GCM popup có thể không hiện. Workaround: chạy `git push` lần đầu từ PowerShell GUI (manual), sau đó các lần sau token cached → automation push được.
