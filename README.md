# Tạp Hóa POS

Phần mềm POS web tối giản cho tiệm tạp hóa Việt Nam. Mobile-first, hoạt động
offline, sẵn sàng cho thiết bị cầm tay (Sunmi, iMin) ở giai đoạn tiếp theo.

## Bắt đầu nhanh

Yêu cầu: Node.js ≥ 20, npm ≥ 10.

```bash
npm install
npm run dev
```

Mở `https://<ip-may-cua-ban>:5173` trên điện thoại trong cùng mạng Wi-Fi để
test trên thiết bị thật. **Camera quét mã vạch yêu cầu HTTPS** — khi dev,
Chrome cho phép `http://localhost` nhưng từ điện thoại khác bạn cần ngrok
hoặc `mkcert` để có HTTPS local.

Cách nhanh: dùng [ngrok](https://ngrok.com)

```bash
npx ngrok http 5173
```

Mở URL HTTPS mà ngrok cấp trên điện thoại — camera sẽ chạy được.

## Test thử

1. Mở app — sẽ tự động seed 12 sản phẩm tạp hóa VN phổ biến vào IndexedDB.
2. Bấm **Quét mã** → cấp quyền camera → đưa gói mì Hảo Hảo / chai Coca / hộp
   sữa Vinamilk thật vào khung. Mã EAN-13 trong seed là mã thật trên thị
   trường.
3. Bấm **Tìm** để thử thêm sản phẩm bằng tay.
4. Bấm **Thanh toán** → chọn tiền mặt, nhập số tiền khách đưa → xem số thối lại.
5. Mở DevTools → Application → IndexedDB → `pos-tap-hoa` để xem dữ liệu thật.

## Tiếp tục với Claude Code

File `CLAUDE.md` ở root chứa toàn bộ context kiến trúc, design system, và
roadmap. Cài Claude Code:

```bash
# macOS / Linux
curl -fsSL claude.ai/install.sh | sh

# Windows (PowerShell)
irm claude.ai/install.ps1 | iex
```

Hoặc qua npm:

```bash
npm install -g @anthropic-ai/claude-code
```

Sau đó vào thư mục project và chạy:

```bash
cd pos-tap-hoa
claude
```

Claude Code sẽ tự đọc `CLAUDE.md` và biết toàn bộ bối cảnh. Bạn có thể nói
ngay: *"Hãy implement trang Sản phẩm cho phép thêm sản phẩm mới bằng cách
quét mã vạch"* — Claude Code sẽ làm đúng theo conventions đã định.

## Build production

```bash
npm run build
npm run preview
```

Output ở `dist/`. PWA sẽ tự đăng ký service worker.

## Deploy lên server riêng

Xem [`HOSTING.md`](./HOSTING.md) — hướng dẫn chi tiết deploy với Docker +
Caddy (auto HTTPS) hoặc nginx có sẵn. **HTTPS bắt buộc** vì camera quét mã
vạch chỉ hoạt động trên HTTPS.

Tóm tắt nhanh với Docker:

```bash
cp .env.example .env
nano .env                    # Sửa DOMAIN
docker compose up -d --build
```

Caddy sẽ tự xin cert Let's Encrypt sau khi DNS trỏ đúng về server.

## Cấu trúc

Xem [`CLAUDE.md`](./CLAUDE.md) — phần "Cấu trúc thư mục" và toàn bộ phần
conventions.

## Roadmap ngắn gọn

- **Giai đoạn 1** (đang dở): hoàn thiện CRUD sản phẩm, báo cáo, đăng nhập,
  Supabase backend, in nhiệt Bluetooth.
- **Giai đoạn 2**: tích hợp HĐĐT từ máy tính tiền (MISA meInvoice / VNPT
  Invoice) để tuân thủ Nghị định 70/2025.
- **Giai đoạn 3**: Capacitor wrapper + plugin native cho Sunmi / iMin để
  truy cập máy in tích hợp và đầu đọc laser.

Chi tiết đầy đủ trong `CLAUDE.md`.

## License

TBD — chưa quyết định mô hình kinh doanh (open core / SaaS đóng / dual license).
