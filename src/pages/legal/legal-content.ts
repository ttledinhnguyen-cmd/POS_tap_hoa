/**
 * Template ToS + Privacy Policy theo NĐ 13/2023 (PDP) + bối cảnh Việt Nam.
 *
 * QUAN TRỌNG: Đây là TEMPLATE GENERIC, founder PHẢI consult luật sư review +
 * customize trước khi launch real customer. Có thể tạm dùng cho beta 5-10
 * shop quen.
 *
 * Placeholders {{BUSINESS_NAME}} / {{SUPPORT_ZALO}} / {{SUPPORT_EMAIL}} sẽ
 * được replace runtime từ env vars.
 */

export const TERMS_MD = `# Điều khoản dịch vụ

**Cập nhật lần cuối**: 2026-05-02

## 1. Định nghĩa

"**Dịch vụ**" là phần mềm bán hàng (POS) trên nền web do {{BUSINESS_NAME}}
("**chúng tôi**") cung cấp cho các tiệm tạp hóa, cửa hàng nhỏ tại Việt Nam.

"**Tài khoản**" là tài khoản người dùng (chủ tiệm hoặc thu ngân) đăng ký để
sử dụng Dịch vụ.

"**Dữ liệu shop**" là toàn bộ thông tin do tiệm nhập vào: sản phẩm, đơn hàng,
khách hàng, báo cáo doanh thu.

## 2. Điều kiện sử dụng

- Tài khoản chỉ được tạo qua mời từ {{BUSINESS_NAME}}. Người dùng tự đăng ký
  công khai không được hỗ trợ.
- Mật khẩu tối thiểu 6 ký tự. Người dùng tự chịu trách nhiệm bảo mật mật khẩu.
- KHÔNG được sử dụng Dịch vụ để bán hàng hóa cấm theo pháp luật Việt Nam
  (ma túy, vũ khí, hàng giả, sách lậu, v.v.).
- KHÔNG được hack, reverse engineer, hoặc làm gián đoạn Dịch vụ.

## 3. Gói cước & thanh toán

- Gói tiêu chuẩn: **199.000đ/tháng**, có thể thay đổi tùy thỏa thuận với
  từng shop.
- Hình thức thanh toán: **chuyển khoản ngân hàng** (manual). Chúng tôi không
  thu thập số thẻ tín dụng.
- Chu kỳ thanh toán: 1, 3, 6, 12 tháng tùy chọn.
- Chính sách trial: linh hoạt theo từng shop, mặc định 30 ngày từ ngày tạo.

## 4. Quyền và nghĩa vụ người dùng

- Quyền: sử dụng đầy đủ tính năng theo gói đăng ký, được hỗ trợ qua Zalo
  ({{SUPPORT_ZALO}}) và email ({{SUPPORT_EMAIL}}).
- Nghĩa vụ: thanh toán đúng hạn, không spam, không vi phạm pháp luật, tuân
  thủ Chính sách bảo mật.

## 5. Quyền và nghĩa vụ nhà cung cấp

- Cam kết uptime: **best-effort** (không SLA chính thức ở giai đoạn beta).
- Backup dữ liệu hàng ngày, lưu trữ tại Supabase Singapore.
- Hỗ trợ trong giờ hành chính qua Zalo + email.
- Chúng tôi có quyền **tạm khóa** (suspend) tài khoản khi:
  - Quá hạn thanh toán > 7 ngày
  - Vi phạm điều khoản
  - Có dấu hiệu lạm dụng dịch vụ

## 6. Hạn chế trách nhiệm

- Chúng tôi không chịu trách nhiệm cho gián đoạn ngoài tầm kiểm soát: sự cố
  internet, mất điện, hỏng thiết bị của người dùng, hành vi của bên thứ 3
  (ngân hàng, nhà cung cấp dịch vụ HĐĐT, mạng viễn thông).
- Trách nhiệm tối đa của chúng tôi đối với 1 shop = phí gói đã thanh toán
  trong 6 tháng gần nhất.

## 7. Force majeure

Trường hợp bất khả kháng (thiên tai, dịch bệnh, chiến tranh, lệnh chính phủ)
miễn trách nhiệm cho cả 2 bên trong thời gian sự kiện diễn ra.

## 8. Chấm dứt dịch vụ

- Người dùng có thể hủy bất cứ lúc nào, hoàn lại phần phí chưa dùng theo
  ngày (prorated).
- Khi chấm dứt: dữ liệu shop được giữ thêm **1 năm** để export. Sau đó xóa
  vĩnh viễn.
- Có thể yêu cầu export dữ liệu (Excel/CSV) bất cứ lúc nào.

## 9. Sửa đổi điều khoản

Chúng tôi có thể sửa đổi điều khoản này. Thông báo trước **30 ngày** qua
email và banner trong app. Tiếp tục sử dụng Dịch vụ sau ngày hiệu lực được
xem là chấp nhận điều khoản mới.

## 10. Luật áp dụng

Điều khoản này được điều chỉnh bởi pháp luật Việt Nam. Tranh chấp được giải
quyết tại tòa án có thẩm quyền tại Việt Nam.

---

Câu hỏi về điều khoản? Liên hệ Zalo {{SUPPORT_ZALO}} hoặc email {{SUPPORT_EMAIL}}.
`;

export const PRIVACY_MD = `# Chính sách bảo mật dữ liệu cá nhân

**Cập nhật lần cuối**: 2026-05-02

Chính sách này tuân thủ **Nghị định 13/2023/NĐ-CP** về bảo vệ dữ liệu cá
nhân (PDP) và các luật liên quan tại Việt Nam.

## 1. Dữ liệu cá nhân chúng tôi thu thập

- **Của chủ shop / nhân viên**: họ tên, email, số điện thoại, mật khẩu (đã
  mã hóa bcrypt).
- **Của tiệm**: tên tiệm, mã số thuế, địa chỉ kinh doanh, số điện thoại liên
  hệ.
- **Dữ liệu giao dịch**: sản phẩm, đơn hàng, doanh thu, tồn kho, phiếu nhập
  kho, kiểm kê. Đây là dữ liệu kinh doanh của shop, KHÔNG phải dữ liệu cá
  nhân của khách lẻ trừ khi shop chủ động lưu (vd. SĐT khách trong order).
- **Dữ liệu kỹ thuật**: log truy cập, IP, user-agent, thời gian truy cập
  (lưu 90 ngày để debug + audit).

## 2. Mục đích thu thập

- Cung cấp Dịch vụ POS theo hợp đồng.
- Hỗ trợ kỹ thuật khi shop báo lỗi.
- Gửi thông báo về subscription (sắp hết hạn, đã thanh toán, etc.) qua
  email.
- Tổng hợp số liệu thống kê **ẩn danh** (tổng số shop active, MRR) để báo
  cáo nội bộ và investor (nếu có).

KHÔNG sử dụng cho marketing đến khách lẻ của shop. KHÔNG bán dữ liệu cho
bên thứ 3.

## 3. Bên thứ 3 xử lý dữ liệu

- **Supabase, Inc.** (data processor): lưu trữ database + auth + edge
  functions. Server tại Singapore. [supabase.com](https://supabase.com)
- **Goong Maps** (geocoding): chỉ gửi địa chỉ text → nhận lat/lng. KHÔNG
  gửi thông tin cá nhân.
- **Open Food Facts**: chỉ gửi mã vạch để lookup tên sản phẩm public. KHÔNG
  gửi thông tin shop.
- **GitHub** (source code hosting): chỉ code app, KHÔNG có dữ liệu shop.

Tất cả các bên trên đều có cam kết bảo mật và GDPR/PDP-equivalent compliance.

## 4. Lưu trữ dữ liệu

- **Vị trí**: Supabase region Singapore (ap-southeast-1).
- **Backup**: hàng ngày tự động qua Supabase Pro tier, giữ 7 ngày.
- **Mã hóa**: TLS 1.2+ trên đường truyền, AES-256 at rest (Supabase managed).

## 5. Quyền của chủ thể dữ liệu (theo NĐ 13/2023)

Người dùng có các quyền sau với dữ liệu cá nhân của mình:

- **Truy cập**: xem dữ liệu chúng tôi đang lưu (app cho phép xem trực tiếp).
- **Sửa đổi**: chỉnh dữ liệu sai (Cài đặt → Thông tin tiệm).
- **Xóa**: yêu cầu xóa tài khoản + toàn bộ dữ liệu liên quan.
- **Hạn chế xử lý**: tạm dừng xử lý dữ liệu (vd. khi đang khiếu nại).
- **Mang đi (data portability)**: export dữ liệu định dạng Excel/CSV.
- **Phản đối**: từ chối xử lý dữ liệu cho mục đích marketing (chúng tôi
  không marketing nên mặc định OK).
- **Khiếu nại**: gửi tới {{SUPPORT_EMAIL}} hoặc Cơ quan bảo vệ dữ liệu cá
  nhân Việt Nam (theo NĐ 13/2023).

## 6. Thời gian lưu trữ

- **Dữ liệu shop active**: trong thời gian dùng dịch vụ + **1 năm** sau khi
  hủy (cho phép export).
- **Hóa đơn điện tử (HĐĐT)**: lưu **10 năm** theo Luật Quản lý thuế.
- **Log truy cập**: 90 ngày.
- **Backup**: 7 ngày rolling.

## 7. Bảo mật

- **Authentication**: email + password (bcrypt hash), session token JWT.
- **Authorization**: Row-Level Security (RLS) trên Postgres — mỗi shop chỉ
  thấy dữ liệu của mình.
- **HTTPS**: bắt buộc, Let's Encrypt cert.
- **2FA**: chưa hỗ trợ ở beta, sẽ thêm cho super_admin trước, sau đó cho
  owner.

## 8. Cookies & tracking

App **chỉ dùng**:

- Session token (lưu trong localStorage) để duy trì đăng nhập.
- Cookie ngrok khi demo (nếu có).

**KHÔNG có** Google Analytics / Facebook Pixel / 3rd party tracking.

## 9. Quyền của trẻ em

Dịch vụ **không nhắm đến** người dưới 18 tuổi. Nếu phát hiện tài khoản trẻ
em, chúng tôi sẽ xóa ngay.

## 10. Liên hệ về privacy

- Email: {{SUPPORT_EMAIL}}
- Zalo: {{SUPPORT_ZALO}}
- Người phụ trách bảo vệ dữ liệu: {{BUSINESS_NAME}}

## 11. Sửa đổi chính sách

Chúng tôi có thể sửa đổi chính sách này. Thông báo trước **30 ngày** qua
email + banner. Người dùng có quyền hủy tài khoản nếu không đồng ý chính
sách mới.

---

Cảm ơn bạn đã tin tưởng {{BUSINESS_NAME}}.
`;
