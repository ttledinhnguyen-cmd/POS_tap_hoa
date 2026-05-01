# START HERE — Đọc file này trước

> File này dành cho con người (chủ dự án). Nếu bạn là Claude Code, đọc `CLAUDE.md`.

## 1. Bạn vừa giải nén gì?

Đây là project **POS Tạp Hóa** — phần mềm POS web cho tiệm tạp hóa Việt Nam,
mobile-first, offline-first, hướng SaaS.

Skeleton đã build production thành công ở session trước. Giờ tới giai đoạn
tích hợp API (Supabase, MISA HĐĐT, VietQR, SePay, Zalo ZNS, in nhiệt BT, ...).

## 2. Cấu trúc thư mục quan trọng

```
pos-tap-hoa/
├── START_HERE.md                       # ← bạn đang đọc
├── CLAUDE.md                           # Auto-load bởi Claude Code, đã update spec
├── README.md                           # Hướng dẫn dev (npm install, dev, build)
├── HOSTING.md                          # Deploy Docker + Caddy
├── docs/
│   ├── API_INTEGRATION_SPEC.md         # ⭐ Spec tích hợp API đầy đủ (71KB)
│   └── SESSION_HANDOFF.pdf             # Context từ session lập kế hoạch
├── src/                                # Code React + TypeScript
├── supabase/                           # Migrations + Edge Functions (Claude Code sẽ tạo)
└── ... (config files)
```

## 3. Cài đặt môi trường

Yêu cầu: **Node.js ≥ 20**, **npm ≥ 10**.

```bash
cd pos-tap-hoa
npm install
npm run dev
```

Mở `http://localhost:5173` trên trình duyệt — app sẽ tự seed 12 sản phẩm
Việt Nam thật vào IndexedDB. Có thể thử **Quét mã** ngay với gói mì Hảo Hảo /
chai Coca / hộp sữa Vinamilk.

> Camera quét mã chỉ chạy trên HTTPS hoặc `localhost`. Test trên điện thoại
> khác → dùng `npx ngrok http 5173`.

## 4. Cài Claude Code

```bash
# macOS / Linux
curl -fsSL claude.ai/install.sh | sh

# Windows (PowerShell)
irm claude.ai/install.ps1 | iex

# Hoặc qua npm
npm install -g @anthropic-ai/claude-code
```

## 5. Bắt đầu coding với Claude Code

```bash
cd pos-tap-hoa
claude
```

Khi Claude Code mở, gõ **đúng prompt sau** (copy-paste):

```
Đọc CLAUDE.md, docs/API_INTEGRATION_SPEC.md và docs/SESSION_HANDOFF.pdf.

Trước khi code, tóm tắt cho tôi:
1. Hiểu sprint plan ở section 6 của API_INTEGRATION_SPEC — Sprint 1 cụ thể cần làm gì
2. Liệt kê các file/migration sẽ tạo trong Sprint 1
3. Có gì trong spec chưa rõ hoặc bạn không đồng ý

Sau khi tôi confirm, bắt đầu Sprint 1 (Supabase backend nền tảng).
```

Claude Code sẽ đọc đầy đủ context, tóm tắt plan, hỏi bạn confirm, rồi tự
thực hiện Sprint 1.

## 6. Kế hoạch tổng thể

Có **9 sprints** trong `docs/API_INTEGRATION_SPEC.md` section 6:

1. **Sprint 1** — Backend nền tảng (Supabase setup, schema, RLS)
2. **Sprint 2** — Auth + Sync layer
3. **Sprint 3** — Thanh toán không tiền mặt (VietQR + SePay)
4. **Sprint 4** — Hóa đơn điện tử (MISA meInvoice) ⚠️ pháp lý bắt buộc 2026
5. **Sprint 5** — In hóa đơn nhiệt Bluetooth
6. **Sprint 6** — Zalo ZNS + SMS OTP (eSMS)
7. **Sprint 7** — Database mã vạch dùng chung + tra cứu MST
8. **Sprint 8** — OCR + Voice (FPT.AI)
9. **Sprint 9+** — Mở rộng (GHN, Goong Maps, FCM push, AI summary, Sentry)

Mỗi sprint xong → push code → deploy thử lên server thật → test trên
điện thoại + desktop → mới sang sprint kế tiếp.

## 7. Trước Sprint 1 cần chuẩn bị

- [ ] Tài khoản Supabase (free tier đủ): https://supabase.com
- [ ] Tài khoản Google Cloud (OAuth client cho login Google)
- [ ] Sau Sprint 3: tài khoản SePay (free tier 100 giao dịch/tháng)
- [ ] Sau Sprint 4: tài khoản MISA meInvoice (sandbox trước, có hợp đồng sau)
- [ ] Sau Sprint 6: tài khoản eSMS + Zalo Official Account

## 8. Khi nào quay lại chat web (Claude.ai)?

- Cần lập kế hoạch tính năng lớn / sprint mới chưa có spec
- Phân tích pháp lý / quyết định kinh doanh
- Review kiến trúc trước khi code

Hai môi trường bổ trợ nhau: **chat web để planning, Claude Code để
execution**.

---

Vướng đâu, hỏi đó. Chúc xây dựng thành công!
