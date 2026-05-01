# Hướng dẫn deploy lên server

> **HTTPS là bắt buộc**, không phải tùy chọn. Camera quét mã vạch chỉ chạy
> trên HTTPS. Nếu server không có HTTPS thì cả app vô dụng.

## Yêu cầu server

Tối thiểu:
- 1 vCPU, 1 GB RAM, 10 GB ổ cứng
- Ubuntu 22.04 LTS hoặc Debian 12 (khuyến nghị)
- Mở port **80** và **443** (TCP), **443** (UDP — cho HTTP/3)
- Một domain trỏ về IP server (DNS A record)

Gợi ý nhà cung cấp cho thị trường VN:
- **BizFly Cloud / Viettel IDC / FPT Cloud**: server đặt tại VN, latency thấp
  cho user trong nước. Giá tham khảo 100–200k/tháng cho gói 1vCPU/1GB.
- **Vultr Singapore / DigitalOcean Singapore**: giá quốc tế từ ~$5/tháng,
  latency từ VN ~30–50ms vẫn chấp nhận được.
- **AWS Lightsail Singapore**: $3.5–5/tháng, dễ scale về sau.

Tránh self-host tại nhà — nhiều ISP Việt Nam chặn port 80/443 cho IP cá nhân.

---

## Cách 1: Docker (khuyến nghị)

### Bước 1: Cài Docker trên server

Ubuntu/Debian:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Logout và login lại để có quyền docker
```

Kiểm tra:

```bash
docker --version
docker compose version
```

### Bước 2: Trỏ DNS

Vào trang quản lý domain (Cloudflare, Tenten, PA Việt Nam, GoDaddy, v.v.) và
tạo bản ghi A:

```
pos.tendomain.com    A    <IP server>
```

Đợi DNS propagate (vài phút đến vài giờ). Kiểm tra:

```bash
dig pos.tendomain.com +short
# Phải trả về đúng IP server
```

**Quan trọng**: Let's Encrypt sẽ verify domain bằng cách gọi lại
`http://pos.tendomain.com/.well-known/acme-challenge/...`. Nếu DNS chưa trỏ
đúng thì cấp cert sẽ fail.

### Bước 3: Clone code lên server

```bash
ssh user@<IP server>
cd /opt    # hoặc thư mục bạn thích
git clone <repo URL của bạn> pos-tap-hoa
cd pos-tap-hoa
```

(Nếu chưa có git repo, scp file zip lên: `scp pos-tap-hoa.zip user@server:/opt/`
rồi `unzip pos-tap-hoa.zip` trên server.)

### Bước 4: Cấu hình domain

```bash
cp .env.example .env
nano .env
```

Sửa:

```
DOMAIN=pos.tendomain.com
ACME_EMAIL=ban@email.com
```

### Bước 5: Khởi động

```bash
docker compose up -d --build
```

Lần đầu sẽ mất 2–5 phút để build. Sau đó Caddy sẽ tự xin cert Let's Encrypt
(thêm 30 giây).

Xem log:

```bash
docker compose logs -f
```

Khi thấy dòng `serving HTTPS on :443` là đã xong.

### Bước 6: Test

Mở `https://pos.tendomain.com` trên điện thoại. Cấp quyền camera khi được hỏi.
Quét thử mã vạch trên gói mì Hảo Hảo / chai Coca → sản phẩm phải hiện ra.

---

## Cách 2: nginx có sẵn (không Docker)

Nếu server đã chạy nginx và bạn không muốn thêm Docker:

```bash
# Trên máy dev, build static files
npm run build
# Copy dist lên server
scp -r dist/* user@server:/var/www/pos-tap-hoa/
```

Trên server:

```bash
# Cài certbot nếu chưa có
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# Copy config từ deploy/nginx.conf, sửa server_name và root
sudo cp deploy/nginx.conf /etc/nginx/sites-available/pos-tap-hoa
sudo nano /etc/nginx/sites-available/pos-tap-hoa
# Đổi pos.example.com → domain của bạn
# Đổi /var/www/pos-tap-hoa nếu cần

sudo ln -s /etc/nginx/sites-available/pos-tap-hoa /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Xin cert HTTPS
sudo certbot --nginx -d pos.tendomain.com
```

Certbot sẽ tự sửa file nginx config thêm phần SSL. Cert tự renew 60 ngày/lần.

---

## Update phiên bản mới

Với Docker:

```bash
cd /opt/pos-tap-hoa
./deploy/deploy.sh
```

Hoặc thủ công:

```bash
git pull
docker compose up -d --build
docker image prune -f
```

Với nginx:

```bash
# Trên máy dev
npm run build
rsync -avz --delete dist/ user@server:/var/www/pos-tap-hoa/
```

User sẽ nhận update PWA tự động trong vài giây sau khi mở app (do
service worker no-cache).

---

## Backup

Static frontend không có data quan trọng — dữ liệu nằm trong IndexedDB của
**điện thoại từng user**. Khi bạn thêm backend Supabase ở giai đoạn sau, cấu
hình backup ở đó.

Thứ duy nhất cần backup ngay là:
- `Caddyfile` / `nginx.conf` — đã trong git, không cần
- Cert Let's Encrypt — Caddy lưu trong volume `caddy_data`, có thể backup:

```bash
docker run --rm -v caddy_data:/data -v $PWD:/backup alpine \
  tar czf /backup/caddy-data-$(date +%F).tar.gz -C /data .
```

Nhưng cũng không cấp thiết vì cert miễn phí, mất thì xin lại được.

---

## Lỗi thường gặp

**`acme: error: 403 ... unauthorized`** — DNS chưa trỏ đúng hoặc port 80
chưa mở. Check:

```bash
dig +short pos.tendomain.com
sudo lsof -i :80    # Phải có Caddy/docker, không có gì khác
sudo ufw status     # Nếu dùng ufw, phải allow 80,443
```

**Camera không bật trên iPhone** — Safari yêu cầu HTTPS hợp lệ và user phải
tap vào nút (không tự động mở camera khi load trang). Kiểm tra cert:

```bash
curl -I https://pos.tendomain.com
# Phải trả về 200 OK, không có warning về cert
```

**Mất mạng → app trắng màn hình** — service worker chưa cache xong. Mở app
một lần khi có mạng để cache, sau đó offline OK.

**Container restart liên tục** — xem log:

```bash
docker compose logs --tail=100
```

Thường do: domain sai, port 80 đã có app khác chiếm, hoặc disk đầy.

---

## Bảo mật cơ bản

```bash
# Firewall - chỉ cho 22 (SSH), 80, 443
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

# Disable SSH password, chỉ dùng key
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart ssh

# Auto update
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

Sau khi có user thật, cân nhắc thêm fail2ban và rate limiting.
