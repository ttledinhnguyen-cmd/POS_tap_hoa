# Spec tích hợp API — POS Tạp Hóa

> File này là tài liệu giao việc cho Claude Code để triển khai layer tích hợp API
> cho phần mềm POS Tạp Hóa. Đọc cùng `CLAUDE.md` trong project root để hiểu
> conventions chung. Tài liệu được viết với giả định stack đã chốt: Vite + React 18
> + TypeScript, Zustand + Dexie/IndexedDB (offline), Tailwind + custom design tokens,
> Supabase BaaS (Singapore region).
>
> **Nguyên tắc quan trọng:** mọi tích hợp phải tuân thủ offline-first — thao tác
> bán hàng vẫn chạy được khi mất mạng, tích hợp bên ngoài chỉ là "best effort"
> chạy nền và đồng bộ khi có mạng.

---

## 0. Kiến trúc & nguyên tắc chung

### 0.1 Adapter pattern (BẮT BUỘC)

Mỗi nhà cung cấp API được wrap trong một adapter triển khai interface chung.
Mục tiêu: dễ swap nhà cung cấp khi cần (vd. đổi MISA meInvoice → VNPT Invoice
mà không phải sửa toàn bộ codebase).

Cấu trúc thư mục:

```
src/
├── integrations/
│   ├── invoice/                 # HĐĐT
│   │   ├── types.ts             # InvoiceProvider interface
│   │   ├── misa.ts              # MISAInvoiceProvider
│   │   ├── vnpt.ts              # VNPTInvoiceProvider (sau)
│   │   └── index.ts             # factory chọn provider theo env
│   ├── payment/
│   │   ├── types.ts             # PaymentVerifier, QRGenerator
│   │   ├── vietqr.ts            # VietQR.io URL builder
│   │   ├── sepay.ts             # SePay webhook handler + match logic
│   │   └── index.ts
│   ├── sms/
│   │   ├── types.ts
│   │   ├── esms.ts
│   │   └── index.ts
│   ├── shipping/                # GHN, Ahamove (giai đoạn 3)
│   ├── ocr/                     # FPT.AI (giai đoạn 2)
│   ├── stt/                     # Web Speech / FPT.AI ASR
│   ├── zalo/                    # ZNS
│   ├── tax-lookup/              # MST
│   └── shared/
│       ├── http.ts              # fetch wrapper có timeout, retry, exp backoff
│       ├── errors.ts            # IntegrationError class
│       └── queue.ts             # offline action queue
```

### 0.2 Env vars convention

Tất cả secret nằm trong `.env.local` (không commit). File `.env.example` liệt kê
tất cả keys nhưng không có value. Tên biến: `VITE_*` cho cái client thấy được,
**còn lại** chạy ở Supabase Edge Functions (server-side, không expose ra browser).

Ví dụ:

```bash
# .env.example
# === Supabase (client-safe) ===
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# === HĐĐT MISA meInvoice (SERVER-SIDE ONLY — Edge Function) ===
MISA_BASE_URL=https://api.meinvoice.vn
MISA_APP_ID=
MISA_APP_SECRET=
MISA_TAX_CODE=

# === SePay webhook ===
SEPAY_WEBHOOK_SECRET=

# === eSMS ===
ESMS_API_KEY=
ESMS_SECRET_KEY=
ESMS_BRAND=TaphoaCoBa

# === Zalo OA ZNS ===
ZALO_OA_ID=
ZALO_OA_ACCESS_TOKEN=

# === FPT.AI ===
FPTAI_API_KEY=

# === GHN ===
GHN_TOKEN=
GHN_SHOP_ID=

# === Ahamove ===
AHAMOVE_TOKEN=

# === Goong ===
VITE_GOONG_API_KEY=  # client-safe (autocomplete trên FE)

# === FCM ===
VITE_FCM_VAPID_KEY=
FCM_SERVICE_ACCOUNT_JSON=

# === AI (tùy chọn) ===
ANTHROPIC_API_KEY=

# === Sentry ===
VITE_SENTRY_DSN=

# === PostHog (tùy chọn) ===
VITE_POSTHOG_KEY=
VITE_POSTHOG_HOST=https://app.posthog.com
```

> **Lưu ý Supabase Edge Functions:** runtime tự động inject `SUPABASE_URL`,
> `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — KHÔNG cần khai báo lại
> trong `.env.example`, KHÔNG commit `service_role` key ở bất kỳ đâu.

**Quy tắc bảo mật:** không bao giờ gọi MISA/SePay/eSMS/FPT.AI trực tiếp từ
browser. Tất cả đi qua Supabase Edge Functions để giấu secret và ký xác thực.
VietQR.io là ngoại lệ vì chỉ là URL builder, không có secret.

### 0.3 Error handling pattern

```typescript
// src/integrations/shared/errors.ts
export class IntegrationError extends Error {
  constructor(
    public provider: string,        // 'misa' | 'sepay' | ...
    public code: string,             // mã lỗi nội bộ
    message: string,
    public retriable: boolean = false,
    public cause?: unknown,
  ) {
    super(`[${provider}] ${code}: ${message}`);
  }
}
```

Mọi adapter throw `IntegrationError`. Layer trên (UI / queue) đọc `retriable`
để quyết định có retry tự động hay không.

### 0.4 HTTP wrapper

```typescript
// src/integrations/shared/http.ts
interface FetchOpts extends RequestInit {
  timeoutMs?: number;
  retry?: number;
  backoffMs?: number;
}

export async function http(url: string, opts: FetchOpts = {}): Promise<Response> {
  const { timeoutMs = 10_000, retry = 0, backoffMs = 500, ...init } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retry; attempt++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok && res.status >= 500 && attempt < retry) {
        await new Promise(r => setTimeout(r, backoffMs * 2 ** attempt));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(tid);
      lastErr = e;
      if (attempt < retry) {
        await new Promise(r => setTimeout(r, backoffMs * 2 ** attempt));
        continue;
      }
    }
  }
  throw lastErr;
}
```

### 0.5 Offline action queue

Mọi thao tác cần đẩy lên server (sync order, phát hành HĐĐT, gửi ZNS) đi qua
một queue lưu trong IndexedDB. Khi có mạng, worker chạy nền pop từng job.

```typescript
// src/integrations/shared/queue.ts
export interface OutboxJob {
  id: string;
  type: 'invoice.issue' | 'order.sync' | 'zns.send' | 'sms.otp' | string;
  payload: unknown;
  attempts: number;
  nextRunAt: number;
  createdAt: number;
  lastError?: string;
}

// Bảng Dexie: outbox
// Hook: navigator.onLine + visibilitychange → drain queue
```

---

## 1. NHÓM 1 — MVP CRITICAL

Không có những API này thì không có MVP. Sprint 1-3.

### 1.1 Supabase — Backend nền tảng

**Mục đích:** Postgres + Auth + Realtime + Storage + Edge Functions trong 1 BaaS.
Region Singapore (`ap-southeast-1`) cho latency tốt nhất với VN.

**Setup ban đầu:**

```bash
npm i @supabase/supabase-js
```

```typescript
// src/integrations/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 5 } },
  },
);
```

**Schema cốt lõi (Postgres / SQL migration):**

```sql
-- Tổ chức (mỗi tiệm = 1 organization)
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tax_code text,                          -- MST tiệm (nếu có)
  address text,
  phone text,
  created_at timestamptz default now()
);

-- User membership (1 user có thể thuộc nhiều tiệm — multi-store về sau)
create table memberships (
  user_id uuid references auth.users not null,
  org_id uuid references organizations not null,
  role text not null check (role in ('owner','cashier')),
  created_at timestamptz default now(),
  primary key (user_id, org_id)
);

-- Sản phẩm
create table products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations not null,
  barcode text,
  name text not null,
  unit text not null default 'cái',
  price_buy bigint not null default 0,    -- đồng VND, KHÔNG decimal
  price_sell bigint not null default 0,
  stock numeric(10,2) not null default 0, -- có thể bán lẻ 0.5kg
  tax_rate numeric(4,2) default 8,        -- 8% hoặc 10%
  category text,
  image_url text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on products (org_id, barcode);
create index on products (org_id, name text_pattern_ops);

-- Đơn hàng
create table orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations not null,
  cashier_id uuid references auth.users,
  subtotal bigint not null,
  tax_amount bigint not null default 0,
  discount bigint not null default 0,
  total bigint not null,
  payment_method text not null check (payment_method in ('cash','transfer','qr','mixed')),
  cash_received bigint,
  change_amount bigint,
  customer_name text,
  customer_phone text,
  customer_tax_code text,
  invoice_status text default 'none' check (invoice_status in ('none','pending','issued','failed','cancelled')),
  invoice_no text,                        -- số HĐĐT khi đã phát hành
  invoice_lookup_code text,               -- mã tra cứu HĐĐT
  invoice_xml_url text,
  invoice_pdf_url text,
  notes text,
  created_at timestamptz default now()
);
create index on orders (org_id, created_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders on delete cascade not null,
  product_id uuid references products,
  product_name text not null,             -- snapshot tên (sản phẩm có thể đổi tên sau)
  unit text not null,
  quantity numeric(10,2) not null,
  price_buy bigint not null,
  price_sell bigint not null,
  tax_rate numeric(4,2) not null default 8,
  line_total bigint not null              -- price_sell * quantity
);

-- Webhook events (SePay, Zalo, MISA)
create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,                   -- 'sepay' | 'misa' | 'zalo'
  event_type text not null,
  payload jsonb not null,
  signature_valid boolean,
  processed boolean default false,
  processed_at timestamptz,
  error text,
  received_at timestamptz default now()
);
create index on webhook_events (source, processed, received_at desc);

-- Outbox (sync nội bộ)
create table outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references organizations not null,
  type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','done','failed')),
  attempts int default 0,
  last_error text,
  next_run_at timestamptz default now(),
  created_at timestamptz default now()
);
```

**RLS (Row Level Security) — BẮT BUỘC bật:**

```sql
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table memberships enable row level security;

-- Helper function
create or replace function user_org_ids()
returns setof uuid language sql security definer stable as $$
  select org_id from memberships where user_id = auth.uid()
$$;

-- Policy: chỉ thấy data của tiệm mình thuộc
create policy "products_select" on products
  for select using (org_id in (select user_org_ids()));
create policy "products_modify" on products
  for all using (org_id in (select user_org_ids()))
  with check (org_id in (select user_org_ids()));

-- Tương tự cho orders, order_items
-- Riêng order_items: kiểm tra qua orders.org_id
create policy "order_items_select" on order_items
  for select using (
    order_id in (select id from orders where org_id in (select user_org_ids()))
  );
```

**Storage buckets:**

- `product-images` (public read, authenticated write) — ảnh sản phẩm
- `invoice-files` (private) — file XML/PDF HĐĐT
- `receipt-snapshots` (private) — ảnh hoá đơn nhập hàng OCR

**Realtime channels:**

- `orders:org_id=eq.{orgId}` — owner xem đơn realtime từ xa
- `products:org_id=eq.{orgId}` — đồng bộ stock giữa nhiều thiết bị cùng tiệm

### 1.2 Auth — Email + Google + Zalo Login

**Mục đích:** đăng nhập + role guard cashier/owner.

**Flow chuẩn:**

1. Email + password (Supabase Auth built-in) — primary
2. Google OAuth — login nhanh cho chủ shop có Gmail
3. Zalo Social Login — phổ biến VN, qua Supabase custom OAuth provider
4. OTP SMS (qua eSMS) cho 2FA owner — optional nhưng khuyến khích

**Code skeleton:**

```typescript
// src/integrations/auth.ts
import { supabase } from './supabase';

export async function signInEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signInGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${location.origin}/auth/callback` },
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Role guard
export async function getCurrentRole(orgId: string): Promise<'owner'|'cashier'|null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', orgId)
    .maybeSingle();
  return data?.role ?? null;
}
```

**Zalo Login** (cấu hình qua Supabase Custom OAuth):

1. Tạo Zalo App tại https://developers.zalo.me, lấy `App ID` + `App Secret`.
2. Trong Supabase Dashboard → Authentication → Providers → Add Custom OAuth:
   - Authorize URL: `https://oauth.zaloapp.com/v4/permission`
   - Token URL: `https://oauth.zaloapp.com/v4/access_token`
   - User info URL: `https://graph.zalo.me/v2.0/me?fields=id,name,picture`
3. Client gọi `supabase.auth.signInWithOAuth({ provider: 'zalo' as any, ... })`.

**Role guard ở UI:**

```typescript
// src/components/RoleGate.tsx
export function RoleGate({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const role = useAuthStore(s => s.role);
  if (!role || !allow.includes(role)) return null;
  return <>{children}</>;
}

// Dùng:
<RoleGate allow={['owner']}>
  <p>Lãi: {formatVND(profit)}đ</p>  {/* cashier không thấy */}
</RoleGate>
```

### 1.3 OTP SMS — eSMS

**Mục đích:** 2FA, xác minh số điện thoại khi tạo tài khoản, gửi mã đặt lại
mật khẩu.

**Provider:** eSMS.vn (rẻ, ổn định, có brandname). Alternative: SpeedSMS,
Viettel Telecom.

**Pricing:** ~600đ/SMS brandname, ~250đ/SMS đầu số ngẫu nhiên (chấp nhận được
cho test).

**Endpoint chính:**

```
POST https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/
Body:
{
  "ApiKey": "...",
  "SecretKey": "...",
  "Content": "Ma OTP cua ban la 123456. Co hieu luc 5 phut.",
  "Phone": "0901234567",
  "Brandname": "TaphoaCoBa",
  "SmsType": "2"      // 2 = brandname, 8 = OTP
}
```

**Adapter:**

```typescript
// src/integrations/sms/types.ts
export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<{ messageId: string }>;
  sendBrandname(phone: string, content: string): Promise<{ messageId: string }>;
}

// src/integrations/sms/esms.ts (chạy ở Edge Function)
export class ESmsProvider implements SmsProvider {
  constructor(private cfg: { apiKey: string; secretKey: string; brand: string }) {}

  async sendOtp(phone: string, code: string) {
    const res = await fetch(
      'https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ApiKey: this.cfg.apiKey,
          SecretKey: this.cfg.secretKey,
          Content: `Ma OTP: ${code}. Hieu luc 5 phut.`,
          Phone: this.normalizePhone(phone),
          Brandname: this.cfg.brand,
          SmsType: '8',
        }),
      },
    );
    const data = await res.json();
    if (data.CodeResult !== '100') {
      throw new IntegrationError('esms', data.CodeResult, data.ErrorMessage, true);
    }
    return { messageId: data.SMSID };
  }

  private normalizePhone(p: string) {
    // 0901... → 84901...
    const digits = p.replace(/\D/g, '');
    return digits.startsWith('0') ? '84' + digits.slice(1) : digits;
  }
}
```

**Edge Function** `supabase/functions/send-otp/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

serve(async (req) => {
  const { phone, purpose } = await req.json();          // purpose: 'login' | 'register'
  const code = String(Math.floor(100000 + Math.random() * 900000));

  // Lưu code vào table otp_codes (TTL 5 phút) cho verify sau
  // ... (code lưu DB)

  const provider = new ESmsProvider({
    apiKey: Deno.env.get('ESMS_API_KEY')!,
    secretKey: Deno.env.get('ESMS_SECRET_KEY')!,
    brand: Deno.env.get('ESMS_BRAND')!,
  });
  const { messageId } = await provider.sendOtp(phone, code);
  return new Response(JSON.stringify({ ok: true, messageId }));
});
```

### 1.4 VietQR.io — QR thanh toán động

**Mục đích:** sinh QR chuyển khoản chuẩn EMV-Compliant để khách quét bằng app
ngân hàng. Có sẵn số tiền, nội dung.

**KHÔNG cần đăng ký, KHÔNG mất phí giao dịch.**

**Format URL:**

```
https://img.vietqr.io/image/{BANK_CODE}-{ACCOUNT_NO}-{TEMPLATE}.png?amount={AMOUNT}&addInfo={MEMO}&accountName={NAME}
```

- `BANK_CODE`: BIN ngân hàng — VCB=970436, MB=970422, Tech=970407, ACB=970416,
  TPB=970423, BIDV=970418, Vietin=970415, Sacom=970403, VPB=970432... (xem
  https://api.vietqr.io/v2/banks)
- `TEMPLATE`: `compact` | `compact2` | `qr_only` | `print` — dùng `compact` cho
  hiển thị quầy, `qr_only` khi chỉ muốn QR thuần (không có logo tiệm).

**Component:**

```typescript
// src/integrations/payment/vietqr.ts
export interface VietQRConfig {
  bankCode: string;        // '970422'
  accountNo: string;
  accountName: string;
  template?: 'compact' | 'compact2' | 'qr_only' | 'print';
}

export function buildVietQRUrl(
  cfg: VietQRConfig,
  amount: number,
  memo: string,
): string {
  const tpl = cfg.template ?? 'compact';
  const params = new URLSearchParams({
    amount: String(amount),
    addInfo: memo,
    accountName: cfg.accountName,
  });
  return `https://img.vietqr.io/image/${cfg.bankCode}-${cfg.accountNo}-${tpl}.png?${params}`;
}
```

**Memo convention** (RẤT QUAN TRỌNG để match webhook):

```
TAPHOA {ORG_PREFIX} {ORDER_SHORT_ID}
Ví dụ: TAPHOA COBA A3X9K2
```

→ Khi webhook SePay nhận được giao dịch về tài khoản, parse memo để tìm
`order_short_id` → đánh dấu order paid.

**UI bottom sheet QR:**

```tsx
// trong PaymentSheet.tsx, khi method === 'qr'
<img
  src={buildVietQRUrl(orgQRConfig, total, `TAPHOA COBA ${orderId.slice(0,6).toUpperCase()}`)}
  alt="VietQR"
  className="aspect-square max-w-xs mx-auto rounded-xl"
/>
<p className="text-center mt-2 text-sm text-ink-muted">
  Quét bằng app ngân hàng. Hệ thống tự xác nhận khi tiền về.
</p>
```

### 1.5 SePay — Webhook biến động số dư

**Mục đích:** xác thực khách đã chuyển khoản thành công → tự đóng đơn QR.

**Tại sao SePay:** free tier 100 giao dịch/tháng, đủ test; trả phí ~100k/tháng
khi scale; doc tiếng Việt rõ. Alternative: Casso (~99k+/tháng, ổn định hơn).

**Setup:**

1. Đăng ký SePay → kết nối tài khoản ngân hàng (qua link OTP, không cần
   internet banking pro).
2. Tạo webhook URL trỏ về Supabase Edge Function:
   `https://{project-ref}.supabase.co/functions/v1/sepay-webhook`.
3. SePay sẽ POST mỗi giao dịch về URL này.

**Payload SePay (tham khảo cấu trúc, verify lại với doc mới nhất khi triển khai):**

```json
{
  "id": 12345,
  "gateway": "MBBank",
  "transactionDate": "2026-04-30 10:23:45",
  "accountNumber": "0123456789",
  "subAccount": null,
  "amountIn": 50000,
  "amountOut": 0,
  "accumulated": 0,
  "code": null,
  "transactionContent": "TAPHOA COBA A3X9K2",
  "referenceNumber": "FT...",
  "description": "..."
}
```

**Edge Function `sepay-webhook`:**

```typescript
// supabase/functions/sepay-webhook/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

serve(async (req) => {
  // Verify signature header (SePay gửi 'Authorization: Apikey {SEPAY_WEBHOOK_SECRET}')
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Apikey ${Deno.env.get('SEPAY_WEBHOOK_SECRET')}`;
  if (auth !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const event = await req.json();

  // Lưu raw event để audit
  await supabase.from('webhook_events').insert({
    source: 'sepay',
    event_type: 'transaction',
    payload: event,
    signature_valid: true,
  });

  // Chỉ xử lý tiền vào
  if (!event.amountIn || event.amountIn <= 0) {
    return new Response('skip outgoing', { status: 200 });
  }

  // Parse memo: "TAPHOA COBA A3X9K2"
  const memo = (event.transactionContent ?? '').toUpperCase();
  const match = memo.match(/TAPHOA\s+(\w+)\s+([A-Z0-9]{6})/);
  if (!match) {
    return new Response('memo no match', { status: 200 });
  }
  const [, orgPrefix, orderShort] = match;

  // Tìm order pending có id bắt đầu bằng orderShort
  const { data: order } = await supabase
    .from('orders')
    .select('id,total,invoice_status,payment_method')
    .ilike('id', `${orderShort.toLowerCase()}%`)
    .eq('payment_method', 'qr')
    .single();

  if (!order) {
    return new Response('order not found', { status: 200 });
  }

  // Verify số tiền KHỚP CHÍNH XÁC (chống thanh toán nhầm)
  if (Number(event.amountIn) !== Number(order.total)) {
    await supabase.from('webhook_events').update({
      processed: true,
      error: `amount mismatch: expected ${order.total}, got ${event.amountIn}`,
    }).eq('id', event.id);
    return new Response('amount mismatch', { status: 200 });
  }

  // Đánh dấu paid + trigger phát hành HĐĐT (qua outbox)
  await supabase.from('orders').update({
    invoice_status: 'pending',          // sẵn sàng phát hành
  }).eq('id', order.id);

  await supabase.from('outbox').insert({
    org_id: order.org_id,
    type: 'invoice.issue',
    payload: { order_id: order.id },
  });

  return new Response('ok', { status: 200 });
});
```

**Realtime UI feedback:** client subscribe `orders:id=eq.{currentOrderId}`,
khi `invoice_status` đổi từ `none` → `pending` → đóng PaymentSheet, hiển
thị "Đã thanh toán".

### 1.6 MISA meInvoice — Hóa đơn điện tử

**Mục đích:** phát hành HĐĐT khởi tạo từ máy tính tiền theo chuẩn Tổng cục Thuế
(Nghị định 70/2025, Thông tư 32/2025). **BẮT BUỘC pháp lý từ 01/01/2026 với
hộ KD doanh thu > 1 tỷ/năm.**

**Tại sao MISA:** thị phần lớn nhất, doc rõ, có sandbox, support tốt. Adapter
pattern cho phép swap sang VNPT sau.

**Pricing (tham khảo, verify trước khi ký):** gói 1000 HĐ ~150k–300k VND. Bạn
mua gói trực tiếp với MISA, KHÔNG resell.

**Auth flow (OAuth2 client credentials):**

```typescript
// src/integrations/invoice/types.ts
export interface InvoiceLineItem {
  name: string;
  unit: string;
  quantity: number;
  unitPrice: number;       // giá chưa thuế (đồng)
  taxRate: number;         // 0 | 5 | 8 | 10
  discount?: number;
}

export interface IssueInvoiceInput {
  orderId: string;
  buyerName?: string;
  buyerTaxCode?: string;
  buyerPhone?: string;
  buyerEmail?: string;
  buyerAddress?: string;
  items: InvoiceLineItem[];
  paymentMethod: 'cash' | 'transfer' | 'qr';
}

export interface IssuedInvoice {
  providerInvoiceId: string;
  invoiceNo: string;            // số HĐ
  lookupCode: string;           // mã tra cứu
  xmlUrl?: string;
  pdfUrl?: string;
  signedAt: string;
}

export interface InvoiceProvider {
  issue(input: IssueInvoiceInput): Promise<IssuedInvoice>;
  cancel(invoiceNo: string, reason: string): Promise<void>;
  getStatus(invoiceNo: string): Promise<'issued'|'cancelled'|'replaced'>;
  downloadPdf(invoiceNo: string): Promise<Uint8Array>;
}
```

```typescript
// src/integrations/invoice/misa.ts
import { IntegrationError } from '../shared/errors';

export class MISAInvoiceProvider implements InvoiceProvider {
  private token?: { value: string; expiresAt: number };

  constructor(private cfg: {
    baseUrl: string;
    appId: string;
    appSecret: string;
    taxCode: string;
  }) {}

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }
    const res = await fetch(`${this.cfg.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: this.cfg.appId,
        appSecret: this.cfg.appSecret,
        taxCode: this.cfg.taxCode,
      }),
    });
    if (!res.ok) throw new IntegrationError('misa', 'AUTH_FAIL', await res.text(), true);
    const { accessToken, expiresIn } = await res.json();
    this.token = {
      value: accessToken,
      expiresAt: Date.now() + (expiresIn * 1000),
    };
    return accessToken;
  }

  async issue(input: IssueInvoiceInput): Promise<IssuedInvoice> {
    const token = await this.getToken();
    const body = {
      orderRefId: input.orderId,
      buyerInfo: {
        buyerName: input.buyerName ?? 'Khách lẻ',
        buyerTaxCode: input.buyerTaxCode,
        buyerPhone: input.buyerPhone,
        buyerEmail: input.buyerEmail,
        buyerAddress: input.buyerAddress,
      },
      items: input.items.map(it => ({
        itemName: it.name,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        vatRate: it.taxRate,
        discount: it.discount ?? 0,
        amount: Math.round(it.quantity * it.unitPrice),
        vatAmount: Math.round(it.quantity * it.unitPrice * it.taxRate / 100),
      })),
      paymentMethod: input.paymentMethod === 'cash' ? 'TM' : 'CK',
      issueDate: new Date().toISOString(),
    };

    const res = await fetch(`${this.cfg.baseUrl}/api/v1/invoices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new IntegrationError('misa', `ISSUE_${res.status}`, err, res.status >= 500);
    }
    const data = await res.json();
    return {
      providerInvoiceId: data.id,
      invoiceNo: data.invoiceNumber,
      lookupCode: data.lookupCode,
      xmlUrl: data.xmlUrl,
      pdfUrl: data.pdfUrl,
      signedAt: data.signedAt,
    };
  }

  async cancel(invoiceNo: string, reason: string) {
    const token = await this.getToken();
    const res = await fetch(`${this.cfg.baseUrl}/api/v1/invoices/${invoiceNo}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new IntegrationError('misa', `CANCEL_${res.status}`, await res.text(), false);
  }

  async getStatus(invoiceNo: string) {
    const token = await this.getToken();
    const res = await fetch(`${this.cfg.baseUrl}/api/v1/invoices/${invoiceNo}/status`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new IntegrationError('misa', 'STATUS_FAIL', await res.text(), true);
    const { status } = await res.json();
    return status;
  }

  async downloadPdf(invoiceNo: string): Promise<Uint8Array> {
    const token = await this.getToken();
    const res = await fetch(`${this.cfg.baseUrl}/api/v1/invoices/${invoiceNo}/pdf`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) throw new IntegrationError('misa', 'PDF_FAIL', await res.text(), true);
    return new Uint8Array(await res.arrayBuffer());
  }
}
```

> ⚠️ **LƯU Ý:** Endpoints và payload trên là *placeholder dựa trên cấu trúc
> chuẩn của MISA*. Khi triển khai thực, đăng ký developer account tại
> https://meinvoice.vn/api, lấy doc chính thức và *điều chỉnh field name khớp 100%*.
> Field `lookupCode` đặc biệt quan trọng — đó là mã tra cứu khách dùng trên
> tracuuhoadon.gdt.gov.vn.

**Edge Function trigger** (chạy khi outbox có job `invoice.issue`):

```typescript
// supabase/functions/issue-invoice/index.ts
serve(async (req) => {
  const { orderId } = await req.json();

  const { data: order } = await supabase
    .from('orders').select('*, order_items(*)').eq('id', orderId).single();
  if (!order) return new Response('not found', { status: 404 });
  if (order.invoice_status === 'issued') return new Response('already issued', { status: 200 });

  const provider = new MISAInvoiceProvider({
    baseUrl: Deno.env.get('MISA_BASE_URL')!,
    appId: Deno.env.get('MISA_APP_ID')!,
    appSecret: Deno.env.get('MISA_APP_SECRET')!,
    taxCode: Deno.env.get('MISA_TAX_CODE')!,
  });

  try {
    const result = await provider.issue({
      orderId: order.id,
      buyerName: order.customer_name,
      buyerTaxCode: order.customer_tax_code,
      buyerPhone: order.customer_phone,
      paymentMethod: order.payment_method,
      items: order.order_items.map((it: any) => ({
        name: it.product_name,
        unit: it.unit,
        quantity: Number(it.quantity),
        unitPrice: Number(it.price_sell),
        taxRate: Number(it.tax_rate),
      })),
    });

    await supabase.from('orders').update({
      invoice_status: 'issued',
      invoice_no: result.invoiceNo,
      invoice_lookup_code: result.lookupCode,
      invoice_xml_url: result.xmlUrl,
      invoice_pdf_url: result.pdfUrl,
    }).eq('id', orderId);

    return new Response('ok');
  } catch (e: any) {
    await supabase.from('orders').update({
      invoice_status: 'failed',
      notes: e.message,
    }).eq('id', orderId);
    throw e;
  }
});
```

**Sai số làm tròn (CỰC KỲ QUAN TRỌNG):** mọi tính toán thuế/tổng đều ở đơn vị
đồng (bigint), KHÔNG dùng float. Quy tắc: `vatAmount = round(quantity * unitPrice * rate / 100)`,
`lineTotal = round(quantity * unitPrice) + vatAmount`. Dùng `Math.round` —
KHÔNG floor/ceil. Cơ quan thuế cross-check tổng → sai 1đ cũng reject.

**Trường hợp huỷ:** chỉ huỷ trong cùng kỳ kê khai. Sau đó phải dùng "hóa đơn
điều chỉnh / thay thế" — phức tạp, cân nhắc làm sau MVP.

---

## 2. NHÓM 2 — PHASE 2 (sản phẩm hoàn thiện)

Sprint 4-7. Khi MVP đã có user thật.

### 2.1 Database mã vạch dùng chung — moat của bạn

**Mục đích:** khi user mới quét EAN-13, hệ thống tự gợi ý tên + ảnh từ kho dữ
liệu chung. Càng nhiều user, kho càng giàu → đối thủ khó đuổi (network effect).

**Schema bổ sung (Supabase):**

```sql
-- Kho mã vạch dùng chung (KHÔNG có org_id — public)
create table shared_barcodes (
  barcode text primary key,
  name text not null,
  brand text,
  category text,
  default_unit text default 'cái',
  image_url text,
  contributor_count int default 1,         -- bao nhiêu org đã xác nhận
  first_seen_at timestamptz default now(),
  last_updated_at timestamptz default now(),
  is_verified boolean default false        -- admin moderation
);
create index on shared_barcodes (last_updated_at desc);

-- Lịch sử đóng góp (chống abuse, có thể dùng để upvote)
create table barcode_contributions (
  id uuid primary key default gen_random_uuid(),
  barcode text references shared_barcodes,
  org_id uuid references organizations,
  proposed_name text,
  proposed_brand text,
  proposed_image_url text,
  created_at timestamptz default now()
);
```

**RLS:**

```sql
-- shared_barcodes: ai cũng READ được, chỉ authenticated mới insert/upsert
alter table shared_barcodes enable row level security;
create policy "shared_barcodes_read" on shared_barcodes for select using (true);
create policy "shared_barcodes_write" on shared_barcodes
  for insert with check (auth.uid() is not null);
```

**Flow khi user quét mã không có trong product riêng:**

```typescript
// src/integrations/barcode/lookup.ts
export async function lookupBarcode(barcode: string): Promise<BarcodeInfo | null> {
  // 1. Kho riêng của org
  const own = await db.products.where('barcode').equals(barcode).first();
  if (own) return { source: 'own', ...own };

  // 2. Kho dùng chung Supabase
  const { data } = await supabase.from('shared_barcodes').select('*').eq('barcode', barcode).maybeSingle();
  if (data) return { source: 'shared', ...data };

  // 3. Fallback Open Food Facts (international, có VN sản phẩm)
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    if (j.status === 1) {
      return {
        source: 'openfoodfacts',
        name: j.product.product_name_vi || j.product.product_name,
        brand: j.product.brands,
        imageUrl: j.product.image_url,
      };
    }
  } catch { /* fallback im lặng */ }

  return null;
}

// Khi user xác nhận và lưu sản phẩm mới → contribute lên kho chung
export async function contributeBarcode(barcode: string, info: BarcodeInfo) {
  await supabase.from('shared_barcodes').upsert({
    barcode,
    name: info.name,
    brand: info.brand,
    image_url: info.imageUrl,
    last_updated_at: new Date().toISOString(),
  }, { onConflict: 'barcode' });
  // tăng contributor_count qua RPC
  await supabase.rpc('increment_barcode_contributor', { p_barcode: barcode });
}
```

**Privacy:** không gửi giá bán/giá vốn lên kho chung — chỉ tên, brand, ảnh,
mã. Giá là bí mật của shop.

**Moderation:** admin dashboard riêng để duyệt `is_verified=true` cho top
1000 mã thông dụng. Sản phẩm chưa duyệt vẫn dùng được nhưng UI cảnh báo
"Dữ liệu cộng đồng — kiểm tra lại".

### 2.2 Zalo ZNS — Notification Service

**Mục đích:** gửi tin Zalo cho khách (xác nhận đơn, nhắc tích điểm, khuyến
mãi). Phổ biến vượt SMS ở VN, **rẻ hơn SMS** (~270đ/tin vs 600đ/SMS brandname).

**Setup:**

1. Tạo Zalo Official Account (OA) — cần giấy phép kinh doanh.
2. Đăng ký Zalo Business Platform → bật ZNS.
3. Submit template (mỗi loại tin = 1 template, phải duyệt 1-3 ngày).
4. Lấy `access_token` (làm mới mỗi 25h qua `refresh_token`).

**Pricing:** ~270đ/tin, gói 10k tin từ ~2.7tr.

**Endpoint:**

```
POST https://business.openapi.zalo.me/message/template
Headers:
  access_token: {ZALO_OA_ACCESS_TOKEN}
  Content-Type: application/json
Body:
{
  "phone": "84901234567",
  "template_id": "123456",
  "template_data": {
    "order_id": "A3X9K2",
    "amount": "245,000đ",
    "shop_name": "Tạp Hóa Cô Ba"
  },
  "tracking_id": "{order_id}"
}
```

**Adapter:**

```typescript
// src/integrations/zalo/zns.ts
export class ZnsProvider {
  constructor(private cfg: { accessToken: string }) {}

  async sendTemplate(input: {
    phone: string;
    templateId: string;
    data: Record<string, string>;
    trackingId?: string;
  }) {
    const res = await fetch('https://business.openapi.zalo.me/message/template', {
      method: 'POST',
      headers: {
        'access_token': this.cfg.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone: this.normalizePhone(input.phone),
        template_id: input.templateId,
        template_data: input.data,
        tracking_id: input.trackingId,
      }),
    });
    const data = await res.json();
    if (data.error !== 0) {
      throw new IntegrationError('zalo-zns', String(data.error), data.message, data.error >= 500);
    }
    return { msgId: data.data.msg_id, sentTime: data.data.sent_time };
  }

  private normalizePhone(p: string) {
    const d = p.replace(/\D/g, '');
    return d.startsWith('0') ? '84' + d.slice(1) : d;
  }
}
```

**Use cases tích hợp:**

| Sự kiện | Template ID | Khi nào |
|---|---|---|
| Order paid | `order_paid_v1` | Sau khi `invoice_status='issued'` |
| Loyalty points earned | `points_earned_v1` | Khi đơn xong nếu khách có số ĐT |
| Low stock alert (cho owner) | `low_stock_v1` | Stock < min_stock |
| Daily report (cho owner) | `daily_report_v1` | Cron 22:00 mỗi ngày |

**Refresh token cron:** Edge Function chạy mỗi 24h, dùng `refresh_token` lấy
`access_token` mới, lưu vào `vault.secrets`.

### 2.3 Tra cứu mã số thuế (MST)

**Mục đích:** khi khách yêu cầu HĐĐT cho công ty, cashier nhập MST → app tự
điền tên công ty + địa chỉ (đỡ gõ tay → giảm sai sót).

**3 cách:**

1. **Tổng cục Thuế public lookup** — `https://tracuunnt.gdt.gov.vn/tcnnt/mstdn.jsp`
   không có JSON API chính thức, phải scrape HTML. Có CAPTCHA → không dùng được
   tự động. **Bỏ qua.**

2. **API.MST.vn** (bên thứ 3) — REST API, có free tier ~100 requests/ngày.
   Endpoint: `GET https://api.mst.vn/companies/{tax_code}` → trả về JSON
   `{name, address, status, ...}`. **Đây là lựa chọn đơn giản.**

3. **Vietqr.io tax-lookup** — free, kèm trong gói VietQR. Endpoint:
   `https://api.vietqr.io/v2/business/{tax_code}`. Có rate limit nhưng đủ cho POS.
   **Khuyến nghị primary.**

**Adapter:**

```typescript
// src/integrations/tax-lookup/vietqr-business.ts
export interface CompanyInfo {
  taxCode: string;
  name: string;
  address?: string;
  status?: string;       // 'active' | 'suspended' | ...
}

export async function lookupTaxCode(taxCode: string): Promise<CompanyInfo | null> {
  const clean = taxCode.replace(/\D/g, '');
  if (clean.length < 10) return null;

  const res = await fetch(`https://api.vietqr.io/v2/business/${clean}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return null;
  const j = await res.json();
  if (j.code !== '00') return null;
  return {
    taxCode: clean,
    name: j.data?.name,
    address: j.data?.address,
    status: j.data?.status,
  };
}
```

**Cache:** lưu kết quả vào `tax_codes_cache` (table mới) TTL 90 ngày để giảm
rate limit và chạy được offline lần sau.

```sql
create table tax_codes_cache (
  tax_code text primary key,
  name text,
  address text,
  status text,
  fetched_at timestamptz default now()
);
```

### 2.4 OCR — FPT.AI

**Mục đích:** chụp hoá đơn nhập hàng từ NCC → tự bóc tách dòng → gợi ý nhập
kho. Tiết kiệm 5-10 phút/lần nhập hàng.

**Provider:** FPT.AI (`https://fpt.ai/vi/products/vision/ocr`) — tiếng Việt
chính xác cao nhất thị trường, ~15-30k VND/100 ảnh.

**Endpoint:**

```
POST https://api.fpt.ai/vision/receipt/vnm
Header: api-key: {FPTAI_API_KEY}
Body: form-data { image: <file> }
```

**Response (rút gọn):**

```json
{
  "errorCode": 0,
  "data": {
    "items": [
      { "name": "Mì Hảo Hảo tôm chua cay", "quantity": 30, "unit_price": 4000, "amount": 120000 },
      { "name": "Sữa Vinamilk 220ml", "quantity": 24, "unit_price": 8500, "amount": 204000 }
    ],
    "total": 324000,
    "vendor_name": "Cty TNHH ABC",
    "vendor_tax_code": "0123456789",
    "issue_date": "2026-04-30"
  }
}
```

**Adapter:**

```typescript
// src/integrations/ocr/fptai.ts
export interface ReceiptOcrResult {
  vendorName?: string;
  vendorTaxCode?: string;
  issueDate?: string;
  total?: number;
  items: { name: string; quantity?: number; unitPrice?: number; amount?: number }[];
}

export class FptAiOcrProvider {
  constructor(private apiKey: string) {}

  async parseReceipt(imageBlob: Blob): Promise<ReceiptOcrResult> {
    const fd = new FormData();
    fd.append('image', imageBlob, 'receipt.jpg');
    const res = await fetch('https://api.fpt.ai/vision/receipt/vnm', {
      method: 'POST',
      headers: { 'api-key': this.apiKey },
      body: fd,
    });
    if (!res.ok) throw new IntegrationError('fptai-ocr', `HTTP_${res.status}`, await res.text(), res.status >= 500);
    const j = await res.json();
    if (j.errorCode !== 0) throw new IntegrationError('fptai-ocr', String(j.errorCode), j.errorMessage, false);
    return {
      vendorName: j.data?.vendor_name,
      vendorTaxCode: j.data?.vendor_tax_code,
      issueDate: j.data?.issue_date,
      total: j.data?.total,
      items: (j.data?.items ?? []).map((it: any) => ({
        name: it.name,
        quantity: it.quantity,
        unitPrice: it.unit_price,
        amount: it.amount,
      })),
    };
  }
}
```

**UI flow:**

1. Owner mở `Sản phẩm` → `Nhập hàng` → `Chụp hoá đơn`.
2. Camera chụp ảnh → upload lên `receipt-snapshots` bucket.
3. Edge Function gọi FPT.AI → trả về danh sách dòng.
4. UI hiển thị bảng review: mỗi dòng OCR map với product (theo barcode/name).
   Cashier xác nhận hoặc sửa, nhấn "Nhập kho" → batch update `products.stock`.

**Image preprocessing:** trước khi gửi, downscale về < 2MB (FPT.AI giới hạn) +
auto-rotate. Dùng thư viện `browser-image-compression` (~25KB).

### 2.5 Speech-to-Text — Web Speech API + FPT.AI ASR fallback

**Mục đích:** owner nhập hàng/kiểm kê bằng giọng nói: "Mì Hảo Hảo nhập 30 gói",
"Sữa Vinamilk còn 12 hộp". Tăng tốc đáng kể so với gõ.

**Strategy:**

1. **Web Speech API** (browser native) — primary, free, chạy offline trên Chrome
   Android. Hỗ trợ `lang='vi-VN'`.
2. **FPT.AI ASR** — fallback khi browser không support hoặc kết quả tệ.

**Web Speech adapter:**

```typescript
// src/integrations/stt/web-speech.ts
export class WebSpeechRecognizer {
  private recognition: any;

  constructor() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) throw new Error('SpeechRecognition not supported');
    this.recognition = new SR();
    this.recognition.lang = 'vi-VN';
    this.recognition.interimResults = true;
    this.recognition.continuous = false;
  }

  start(onResult: (text: string, isFinal: boolean) => void, onError?: (e: any) => void) {
    this.recognition.onresult = (e: any) => {
      const last = e.results[e.results.length - 1];
      onResult(last[0].transcript, last.isFinal);
    };
    this.recognition.onerror = onError;
    this.recognition.start();
  }

  stop() { this.recognition.stop(); }
}
```

**Parse intent layer:** sau khi có transcript "mì hảo hảo nhập 30 gói", parse
ra `{ action: 'restock', productQuery: 'mì hảo hảo', quantity: 30, unit: 'gói' }`.

```typescript
// src/integrations/stt/parser.ts
export interface VoiceIntent {
  action: 'restock' | 'check_stock' | 'add_to_cart' | 'unknown';
  productQuery: string;
  quantity?: number;
  unit?: string;
}

const NUMBER_WORDS: Record<string, number> = {
  'không': 0, 'một': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'năm': 5,
  'sáu': 6, 'bảy': 7, 'tám': 8, 'chín': 9, 'mười': 10,
  'hai mươi': 20, 'ba mươi': 30, /* ... */
};

export function parseVoice(text: string): VoiceIntent {
  const lower = text.toLowerCase().trim();

  // Pattern: "<product> nhập <số> <đơn vị>"
  let m = lower.match(/^(.+?)\s+(?:nhập|thêm)\s+(\d+|[\p{L}\s]+?)\s+(gói|chai|hộp|cái|kg|lốc|thùng)$/u);
  if (m) {
    return {
      action: 'restock',
      productQuery: m[1],
      quantity: parseQuantity(m[2]),
      unit: m[3],
    };
  }

  // Pattern: "<product> còn bao nhiêu"
  m = lower.match(/^(.+?)\s+(?:còn\s+(?:bao\s+nhiêu|mấy)|kho)$/);
  if (m) return { action: 'check_stock', productQuery: m[1] };

  return { action: 'unknown', productQuery: lower };
}

function parseQuantity(s: string): number {
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  return NUMBER_WORDS[s] ?? 0;
}
```

**FPT.AI ASR fallback** (Edge Function, dùng khi Web Speech fail):

```
POST https://api.fpt.ai/hmi/asr/general
Header: api-key: {FPTAI_API_KEY}
Body: raw audio (wav/m4a)
```

---

## 3. NHÓM 3 — EXPANSION (giai đoạn 3-4)

Sprint 8+. Khi đã ổn ở segment tạp hoá, mở rộng tính năng phụ.

### 3.1 Vận chuyển — GHN, Ahamove

**Mục đích:** khi tạp hoá nhận đơn giao hàng (qua app riêng / Zalo), đẩy đơn
sang đơn vị vận chuyển và tracking trạng thái.

**Khuyến nghị:** GHN làm primary (mạng phủ rộng, doc tốt nhất), Ahamove cho
giao nhanh nội thành (2h).

#### 3.1.1 GHN Open API

**Setup:** đăng ký tài khoản shop tại https://khachhang.ghn.vn → bật Open API
→ lấy `Token` + `ShopID`.

**Endpoints chính:**

```
Base: https://online-gateway.ghn.vn/shiip/public-api

POST /v2/shipping-order/create        # Tạo đơn
POST /v2/shipping-order/cancel        # Huỷ đơn
GET  /v2/shipping-order/detail?order_code=XXX
GET  /v2/shipping-order/leadtime      # Tính phí + thời gian dự kiến
GET  /master-data/province
GET  /master-data/district?province_id=XXX
GET  /master-data/ward?district_id=XXX
```

**Headers:**

```
Token: {GHN_TOKEN}
ShopId: {GHN_SHOP_ID}
Content-Type: application/json
```

**Adapter:**

```typescript
// src/integrations/shipping/ghn.ts
export interface CreateShippingOrderInput {
  toName: string;
  toPhone: string;
  toAddress: string;
  toWardCode: string;
  toDistrictId: number;
  weight: number;             // gram
  length: number; width: number; height: number;  // cm
  insuranceValue?: number;
  codAmount?: number;         // tiền thu hộ (đồng)
  serviceTypeId?: number;     // 2 = standard, 5 = express
  paymentTypeId?: 1 | 2;      // 1 = shop trả, 2 = khách trả
  requiredNote?: 'CHOTHUHANG' | 'CHOXEMHANGKHONGTHU' | 'KHONGCHOXEMHANG';
  items: { name: string; quantity: number; price: number }[];
}

export class GhnProvider {
  constructor(private cfg: { token: string; shopId: string }) {}

  private headers() {
    return {
      'Token': this.cfg.token,
      'ShopId': this.cfg.shopId,
      'Content-Type': 'application/json',
    };
  }

  async createOrder(input: CreateShippingOrderInput) {
    const res = await fetch(
      'https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/create',
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          to_name: input.toName,
          to_phone: input.toPhone,
          to_address: input.toAddress,
          to_ward_code: input.toWardCode,
          to_district_id: input.toDistrictId,
          weight: input.weight,
          length: input.length,
          width: input.width,
          height: input.height,
          insurance_value: input.insuranceValue ?? 0,
          cod_amount: input.codAmount ?? 0,
          service_type_id: input.serviceTypeId ?? 2,
          payment_type_id: input.paymentTypeId ?? 1,
          required_note: input.requiredNote ?? 'CHOXEMHANGKHONGTHU',
          items: input.items,
        }),
      },
    );
    if (!res.ok) throw new IntegrationError('ghn', `HTTP_${res.status}`, await res.text(), res.status >= 500);
    const j = await res.json();
    return {
      orderCode: j.data.order_code,
      totalFee: j.data.total_fee,
      expectedDeliveryTime: j.data.expected_delivery_time,
    };
  }

  async getDetail(orderCode: string) {
    const res = await fetch(
      `https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/detail?order_code=${orderCode}`,
      { headers: this.headers() },
    );
    return (await res.json()).data;
  }

  async cancel(orderCode: string) {
    return fetch(
      'https://online-gateway.ghn.vn/shiip/public-api/v2/shipping-order/cancel',
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ order_codes: [orderCode] }),
      },
    );
  }
}
```

**Webhook tracking:** GHN có webhook trạng thái đơn (configure trong dashboard,
trỏ về Edge Function `ghn-webhook`). Status codes quan trọng: `ready_to_pick`,
`picked`, `transporting`, `delivered`, `delivery_fail`, `return`.

#### 3.1.2 Ahamove

Giao nhanh nội thành (xe máy, ship 1-2h). Doc:
https://docs.ahamove.com/api/v3/.

```
Base: https://api.ahamove.com
POST /v1/order/create
GET  /v1/order/detail?order_id=XXX
POST /v1/order/cancel
```

Ahamove cần OTP confirm tài xế khi giao xong → KHÔNG quan trọng cho MVP, làm
sau khi GHN đã chạy ổn.

### 3.2 Goong Maps — Bản đồ + autocomplete địa chỉ

**Mục đích:** khi nhập địa chỉ giao hàng, autocomplete tỉnh/quận/phường tiếng
Việt, lấy lat/lng để GHN tính phí.

**Tại sao Goong:** rẻ hơn Google Maps ~5x cho cùng feature, doc tiếng Việt,
free tier 1000 requests/ngày.

**Pricing:** miễn phí 1000 req/ngày, sau đó ~30đ/req.

**Endpoints:**

```
Base: https://rsapi.goong.io

GET /Place/AutoComplete?api_key={KEY}&input=...
GET /Place/Detail?api_key={KEY}&place_id=...
GET /geocode?api_key={KEY}&address=...
GET /DistanceMatrix?api_key={KEY}&origins=lat,lng&destinations=lat,lng
```

**Adapter:**

```typescript
// src/integrations/maps/goong.ts
export interface PlaceSuggestion {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export class GoongMaps {
  constructor(private apiKey: string) {}

  async autocomplete(query: string): Promise<PlaceSuggestion[]> {
    if (query.length < 3) return [];
    const url = `https://rsapi.goong.io/Place/AutoComplete?api_key=${this.apiKey}&input=${encodeURIComponent(query)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const j = await res.json();
    return (j.predictions ?? []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text,
      secondaryText: p.structured_formatting?.secondary_text,
    }));
  }

  async getDetail(placeId: string) {
    const url = `https://rsapi.goong.io/Place/Detail?api_key=${this.apiKey}&place_id=${placeId}`;
    const r = await fetch(url);
    const j = await r.json();
    return j.result;
  }
}
```

**Lưu ý quan trọng:** GHN/Ahamove cần `district_id` và `ward_code` chứ không
phải lat/lng. Phải có một bước map từ địa chỉ Goong → GHN master-data. Cách
đơn giản: cron đầu tiên đồng bộ toàn bộ tỉnh/huyện/xã VN từ GHN
master-data API về Supabase, sau đó fuzzy match tên với kết quả Goong.

```sql
create table address_master (
  province_id int, province_name text,
  district_id int, district_name text,
  ward_code text, ward_name text,
  primary key (district_id, ward_code)
);
```

### 3.3 Firebase Cloud Messaging (FCM) — Push notification

**Mục đích:** push cho owner trên app "Chủ" (giai đoạn 4) — alert đơn mới,
cảnh báo tồn kho, doanh thu cuối ngày.

**Setup:**

1. Tạo Firebase project → bật Cloud Messaging.
2. Lấy `VAPID key` cho web push.
3. Lấy `Service Account JSON` cho server-side gửi push.

**Đăng ký token (client):**

```typescript
// src/integrations/push/fcm.ts
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

export async function registerPush(): Promise<string | null> {
  const app = initializeApp({ /* config */ });
  const messaging = getMessaging(app);
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;
  const token = await getToken(messaging, {
    vapidKey: import.meta.env.VITE_FCM_VAPID_KEY,
  });
  // Lưu token vào Supabase: table push_tokens (user_id, token, platform)
  await supabase.from('push_tokens').upsert({
    user_id: (await supabase.auth.getUser()).data.user?.id,
    token,
    platform: 'web',
  }, { onConflict: 'token' });
  return token;
}

export function listenForeground(handler: (payload: any) => void) {
  const messaging = getMessaging();
  onMessage(messaging, handler);
}
```

**Service worker `public/firebase-messaging-sw.js`:** xử lý push background,
hiện notification.

**Server-side gửi** (Edge Function dùng `firebase-admin` hoặc REST API trực
tiếp với OAuth2 từ service account):

```typescript
// supabase/functions/send-push/index.ts
const accessToken = await getGoogleAccessToken(); // từ service account JSON
await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: {
      token: '...',
      notification: { title: 'Đơn mới', body: 'Khách vừa thanh toán 245.000đ' },
      webpush: { fcm_options: { link: '/orders/abc' } },
    },
  }),
});
```

### 3.4 Máy in nhiệt 58mm — Web Bluetooth + Web USB

**Mục đích:** in hoá đơn ngay tại quầy. Hỗ trợ cả 2 loại kết nối phổ biến ở VN:

| Loại | Máy in điển hình | Giá tham khảo | Use case |
|---|---|---|---|
| **Bluetooth** | Xprinter XP-P200, RP58, GP-58 | 400-700k VND | Mobile-first, có pin, không dây |
| **USB** | Xprinter XP-200, Star TSP100, Epson TM-T20 | 250-500k VND | Quầy PC truyền thống, plug-and-play |

**Browser support:** Web Bluetooth + Web USB chạy trên Chrome desktop + Chrome
Android. **KHÔNG iOS Safari, KHÔNG Firefox** → cần Capacitor wrapper
(Sprint 9+) cho iOS.

**Common protocol:** Cả 2 loại nhận lệnh **ESC/POS** chuẩn. Chỉ khác cách gửi
buffer xuống device. Receipt template dùng chung — chỉ wrap-and-send khác nhau.

**Library:** `escpos-buffer` (~30KB) — build ESC/POS commands buffer.

```bash
npm i escpos-buffer
```

#### Adapter pattern (BẮT BUỘC)

```typescript
// src/integrations/printer/types.ts
export type PrinterType = 'bluetooth' | 'usb';

export interface PrinterAdapter {
  type: PrinterType;
  isSupported(): boolean;
  pair(): Promise<{ id: string; name: string }>;
  getStored(): Promise<{ id: string; name: string } | null>;
  print(buffer: Uint8Array): Promise<void>;
  forget(): Promise<void>;
}
```

#### Bluetooth adapter

```typescript
// src/integrations/printer/bluetooth.ts
import type { PrinterAdapter } from './types';

const SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const CHAR_UUID    = '00002af1-0000-1000-8000-00805f9b34fb';
const STORAGE_KEY  = 'printer.bluetooth.deviceId';

export const bluetoothPrinter: PrinterAdapter = {
  type: 'bluetooth',

  isSupported() {
    return 'bluetooth' in navigator && typeof navigator.bluetooth.requestDevice === 'function';
  },

  async pair() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    });
    localStorage.setItem(STORAGE_KEY, device.id);
    return { id: device.id, name: device.name ?? 'Máy in BT' };
  },

  async getStored() {
    const id = localStorage.getItem(STORAGE_KEY);
    if (!id) return null;
    // Chrome 115+ có navigator.bluetooth.getDevices() trả devices đã pair
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((d) => d.id === id);
    return device ? { id: device.id, name: device.name ?? 'Máy in BT' } : null;
  },

  async print(buffer) {
    const id = localStorage.getItem(STORAGE_KEY);
    if (!id) throw new Error('Chưa pair máy in Bluetooth');
    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((d) => d.id === id);
    if (!device) throw new Error('Máy in không tìm thấy');

    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const char = await service.getCharacteristic(CHAR_UUID);

    // BLE giới hạn 200 byte/chunk
    for (let i = 0; i < buffer.length; i += 200) {
      await char.writeValueWithoutResponse(buffer.slice(i, i + 200));
    }
  },

  async forget() {
    localStorage.removeItem(STORAGE_KEY);
  },
};
```

#### USB adapter

```typescript
// src/integrations/printer/usb.ts
import type { PrinterAdapter } from './types';

// Class 0x07 = USB Printer Class. Một số máy TQ không khai đúng class
// → fallback filter rỗng (request user pick device).
const STORAGE_KEY = 'printer.usb.identity';

interface StoredId { vendorId: number; productId: number; name: string }

export const usbPrinter: PrinterAdapter = {
  type: 'usb',

  isSupported() {
    return 'usb' in navigator && typeof navigator.usb.requestDevice === 'function';
  },

  async pair() {
    const device = await navigator.usb.requestDevice({
      filters: [{ classCode: 0x07 }, {}], // printer class, fallback rỗng
    });
    const id: StoredId = {
      vendorId: device.vendorId,
      productId: device.productId,
      name: device.productName ?? 'Máy in USB',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(id));
    return { id: `${device.vendorId}-${device.productId}`, name: id.name };
  },

  async getStored() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredId;
    // navigator.usb.getDevices() trả device đã grant permission
    const devices = await navigator.usb.getDevices();
    const device = devices.find(
      (d) => d.vendorId === stored.vendorId && d.productId === stored.productId,
    );
    return device
      ? { id: `${device.vendorId}-${device.productId}`, name: stored.name }
      : null;
  },

  async print(buffer) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('Chưa pair máy in USB');
    const stored = JSON.parse(raw) as StoredId;
    const devices = await navigator.usb.getDevices();
    const device = devices.find(
      (d) => d.vendorId === stored.vendorId && d.productId === stored.productId,
    );
    if (!device) throw new Error('Máy in USB không tìm thấy');

    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    // Tìm interface có endpoint OUT
    const iface = device.configuration!.interfaces.find((i) =>
      i.alternates[0].endpoints.some((e) => e.direction === 'out'),
    );
    if (!iface) throw new Error('Không tìm được endpoint OUT');
    const endpoint = iface.alternates[0].endpoints.find((e) => e.direction === 'out')!;

    await device.claimInterface(iface.interfaceNumber);

    // USB chunk 64 byte (an toàn cho most thermal printers)
    for (let i = 0; i < buffer.length; i += 64) {
      await device.transferOut(endpoint.endpointNumber, buffer.slice(i, i + 64));
    }

    await device.releaseInterface(iface.interfaceNumber);
    await device.close();
  },

  async forget() {
    localStorage.removeItem(STORAGE_KEY);
  },
};
```

#### Factory + Settings UI

```typescript
// src/integrations/printer/index.ts
import { bluetoothPrinter } from './bluetooth';
import { usbPrinter } from './usb';
import type { PrinterAdapter, PrinterType } from './types';

export const printerAdapters: Record<PrinterType, PrinterAdapter> = {
  bluetooth: bluetoothPrinter,
  usb: usbPrinter,
};

export function getSupportedAdapters(): PrinterAdapter[] {
  return Object.values(printerAdapters).filter((a) => a.isSupported());
}

export async function getActivePrinter(): Promise<PrinterAdapter | null> {
  for (const adapter of getSupportedAdapters()) {
    const stored = await adapter.getStored();
    if (stored) return adapter;
  }
  return null;
}
```

**Settings → Máy in** UI flow:
- Status card: hiển thị adapter đang active (BT/USB) + tên máy in.
- 2 button **Pair**: 1 cho BT, 1 cho USB. Chỉ render adapter `isSupported()=true`.
- Sau pair: button "In thử" + "Quên máy in".

#### Receipt template chung

```typescript
// src/integrations/printer/receipt-template.ts
import { EscPos } from 'escpos-buffer';
import { formatVND } from '@/lib/format';

export interface ReceiptData {
  shopName: string;
  shopAddress?: string;
  shopPhone?: string;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
  total: number;
  invoiceLookupCode?: string;
}

export function buildReceiptBuffer(receipt: ReceiptData): Uint8Array {
  const pos = new EscPos();
  pos.setCharacterCodeTable(0x10); // VN
  pos.setAlignment('center');
  pos.setBold(true);
  pos.print(receipt.shopName);
  pos.setBold(false);
  pos.setSize(0, 0);
  if (receipt.shopAddress) pos.print(receipt.shopAddress);
  if (receipt.shopPhone) pos.print(receipt.shopPhone);
  pos.feed(1);
  pos.print('--------------------------------');
  pos.setAlignment('left');

  for (const item of receipt.items) {
    pos.print(item.name);
    const qty = `  ${item.quantity} x ${formatVND(item.unitPrice)}`;
    const total = `${formatVND(item.lineTotal)}đ`;
    pos.print(padBetween(qty, total, 32));
  }

  pos.print('--------------------------------');
  pos.setBold(true);
  pos.print(padBetween('TỔNG CỘNG', `${formatVND(receipt.total)}đ`, 32));
  pos.setBold(false);
  pos.feed(1);

  if (receipt.invoiceLookupCode) {
    pos.setAlignment('center');
    pos.print('Tra cứu HĐĐT:');
    pos.print('tracuuhoadon.gdt.gov.vn');
    pos.print(`Mã: ${receipt.invoiceLookupCode}`);
    pos.qrCode(`https://tracuuhoadon.gdt.gov.vn/tracuu?code=${receipt.invoiceLookupCode}`);
  }

  pos.feed(2);
  pos.cut();
  return pos.flush();
}

function padBetween(left: string, right: string, width: number) {
  const space = Math.max(1, width - left.length - right.length);
  return left + ' '.repeat(space) + right;
}
```

**Print flow:**

```typescript
const adapter = await getActivePrinter();
if (!adapter) throw new Error('Chưa cấu hình máy in');
const buffer = buildReceiptBuffer(receiptData);
await adapter.print(buffer);
```

#### iOS fallback (Sprint 9+ Capacitor)

- **BT**: `@capacitor-community/bluetooth-le` — wrap native BLE API
- **USB OTG**: chỉ Android (`@capacitor-community/usb`). iOS không hỗ trợ USB
  OTG cho thermal printer → **user iOS chỉ in qua Bluetooth**.

---

## 4. NHÓM 4 — TÙY CHỌN (cải thiện UX)

### 4.1 AI — Anthropic Claude API (hoặc OpenAI/Groq)

**Mục đích:**
- Tóm tắt báo cáo cuối ngày bằng tiếng Việt tự nhiên (cho owner đọc nhanh).
- Gợi ý sản phẩm cần nhập thêm dựa trên xu hướng bán.
- Phân loại sản phẩm tự động khi có data text.
- Trợ lý vận hành cho cashier mới: "Cách hoàn tiền là gì?".

**Khuyến nghị:** Anthropic Claude (Haiku 4.5 cho cost) — chất lượng tiếng Việt
tốt nhất nhóm, ~$0.25/M input tokens.

**KHÔNG bao giờ gọi từ client** (lộ API key). Đi qua Edge Function.

**Adapter:**

```typescript
// src/integrations/ai/anthropic.ts (chạy ở Edge Function)
export async function summarizeDailyReport(input: {
  date: string;
  totalRevenue: number;
  orderCount: number;
  topProducts: { name: string; quantity: number; revenue: number }[];
  lowStockProducts: { name: string; remaining: number }[];
}): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Bạn là trợ lý cho chủ tiệm tạp hoá Việt Nam. Viết bằng tiếng Việt tự nhiên, ngắn gọn (3-4 câu), tóm tắt báo cáo ngày ${input.date}:

- Doanh thu: ${input.totalRevenue.toLocaleString('vi-VN')}đ
- Số đơn: ${input.orderCount}
- Top bán chạy: ${input.topProducts.slice(0,3).map(p => `${p.name} (${p.quantity})`).join(', ')}
- Sắp hết: ${input.lowStockProducts.slice(0,3).map(p => `${p.name} (còn ${p.remaining})`).join(', ')}

Đưa ra 1 nhận xét hữu ích (vd. so với hôm trước, gợi ý nhập gì).`,
      }],
    }),
  });
  const j = await res.json();
  return j.content[0].text;
}
```

**Use case khác:** mỗi tối 22:00 cron sinh báo cáo + gửi qua Zalo ZNS template
`daily_report_v1`.

### 4.2 Sentry — Error tracking

**Mục đích:** bắt JS errors trong production để fix sớm. Free tier 5k events/
tháng, đủ cho phase đầu.

```bash
npm i @sentry/react
```

```typescript
// src/main.tsx
import * as Sentry from '@sentry/react';

if (import.meta.env.PROD) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,             // 10% transactions
    replaysSessionSampleRate: 0,        // tắt session replay (tiết kiệm bandwidth)
    beforeSend(event) {
      // KHÔNG gửi PII (số điện thoại, MST khách)
      return scrubPII(event);
    },
  });
}
```

### 4.3 PostHog — Product analytics

**Mục đích:** track user funnel để biết tính năng nào dùng nhiều, retention bao
nhiêu, cashier dùng feature gì sai.

**Có thể self-host** trên VPS riêng (Docker compose) — privacy-first, không
gửi data ra ngoài.

```typescript
// src/integrations/analytics/posthog.ts
import posthog from 'posthog-js';

posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
  api_host: import.meta.env.VITE_POSTHOG_HOST,
  autocapture: false,                  // KHÔNG auto-track click (tránh leak data)
  capture_pageview: true,
});

// Track có chủ ý
posthog.capture('order_completed', { method: 'qr', total: 245000 });
posthog.capture('barcode_scanned', { found: true });
```

### 4.4 eTax (Tổng cục Thuế) — Báo cáo gợi ý tờ khai

**Mục đích:** xuất báo cáo theo format tờ khai thuế GTGT/TNCN quý → owner
upload trực tiếp vào eTax.

**Thực tế:** không có public API gửi tờ khai trực tiếp. **Tích hợp gián tiếp**
qua MISA meInvoice — nhà cung cấp HĐĐT thường có module "kê khai thuế" gửi
được sang eTax.

→ KHÔNG tự xây. Chỉ xuất file XML/Excel theo format chuẩn để owner copy paste
hoặc upload qua MISA.

---

## 5. KIẾN TRÚC TÍCH HỢP — DECISION GRID

| Yêu cầu | Phía | Lý do |
|---|---|---|
| Supabase client (CRUD, auth, realtime) | Browser | Anon key có RLS bảo vệ |
| VietQR.io URL builder | Browser | Không có secret |
| Goong autocomplete | Browser | API key client-safe (rate limit theo domain) |
| Web Bluetooth in nhiệt | Browser | Phải có để reach hardware |
| Web Speech API | Browser | Native browser API |
| MISA meInvoice | **Edge Function** | App secret + tax code |
| SePay webhook | **Edge Function** | Verify signature, mutate orders |
| eSMS OTP | **Edge Function** | API key |
| Zalo ZNS | **Edge Function** | Access token |
| FPT.AI OCR + ASR | **Edge Function** | API key |
| GHN/Ahamove | **Edge Function** | Token shop |
| FCM push (gửi) | **Edge Function** | Service account |
| Anthropic API | **Edge Function** | API key |
| Tax-code lookup (vietqr.io/v2/business) | Browser HOẶC Edge | Free, có thể cả 2 — Edge để cache |

---

## 6. THỨ TỰ TRIỂN KHAI (sprint plan)

### Sprint 1 — Backend nền tảng
1. Khởi tạo Supabase project, region Singapore.
2. Tạo migrations: `organizations`, `memberships`, `products`, `orders`,
   `order_items`, `outbox`, `webhook_events`.
3. Bật RLS + policy cơ bản.
4. Cấu hình Auth: email/password + Google OAuth.
5. Storage buckets: `product-images`, `invoice-files`, `receipt-snapshots`.
6. Wire client `src/integrations/supabase.ts`.

### Sprint 2 — Auth + Sync layer
1. Trang Đăng nhập (email + Google).
2. Role guard component `<RoleGate>`.
3. Sync layer: trên IndexedDB local có gì mới → push lên Supabase, kéo về
   thay đổi từ realtime channel.
4. Outbox queue worker (drain khi `navigator.onLine`).

### Sprint 3 — Thanh toán không tiền mặt
1. VietQR.io component trong PaymentSheet (method = 'qr').
2. Đăng ký SePay, kết nối tài khoản ngân hàng.
3. Edge Function `sepay-webhook` (verify signature, match memo, update order).
4. Realtime UI: client subscribe order, đóng PaymentSheet khi `invoice_status`
   chuyển trạng thái.
5. Test end-to-end với 1 giao dịch nhỏ thật.

### Sprint 4 — Hóa đơn điện tử
1. Đăng ký MISA meInvoice sandbox.
2. Adapter `MISAInvoiceProvider`.
3. Edge Function `issue-invoice` đọc outbox.
4. UI: status badge trên order card (pending / issued / failed), nút retry.
5. Lưu PDF/XML vào bucket `invoice-files`, expose link tra cứu cho khách.
6. Cancel flow + UI.

### Sprint 5 — In hóa đơn nhiệt
1. Web Bluetooth pairing UI.
2. Adapter `printReceipt`.
3. Template ESC/POS cho hoá đơn 58mm.
4. Auto-reconnect device.

### Sprint 6 — Zalo ZNS + SMS OTP
1. Tạo Zalo OA, đăng ký template `order_paid_v1`.
2. Edge Function `send-zns`.
3. Đăng ký eSMS brandname.
4. Edge Function `send-otp` (login OTP, đặt lại password).
5. Refresh token cron cho Zalo.

### Sprint 7 — Database mã vạch dùng chung + Tax lookup
1. Tables `shared_barcodes`, `barcode_contributions`, `tax_codes_cache`.
2. RLS public read.
3. `lookupBarcode()` chain: own → shared → Open Food Facts.
4. Contribute flow khi user thêm sản phẩm mới.
5. Tax-code autocomplete trong PaymentSheet (hiển thị khi khách check "Lấy hoá
   đơn cty").

### Sprint 8 — OCR + Voice
1. FPT.AI OCR Edge Function.
2. UI nhập hàng từ ảnh hoá đơn.
3. Web Speech API + parser intent.
4. UI nhập hàng/kiểm kê bằng giọng nói.

### Sprint 9+ — Mở rộng
- GHN + Ahamove (nếu có nhu cầu giao hàng).
- Goong autocomplete địa chỉ.
- FCM push (cho app "Chủ" giai đoạn 4).
- AI summary report (Anthropic).
- Sentry + PostHog.

---

## 7. CHECKLIST DEVOPS

### Trước go-live MVP

- [ ] Supabase migrations apply lên cả `dev` và `prod` project riêng biệt.
- [ ] RLS BẬT cho tất cả tables. Test: dùng anon token thử select → phải fail
      nếu không thuộc org.
- [ ] Edge Functions deploy: `sepay-webhook`, `issue-invoice`, `send-otp`,
      `send-zns`.
- [ ] Webhook URL SePay đã trỏ về `prod` Edge Function.
- [ ] HTTPS bắt buộc (Caddy đã setup) — camera + Web Bluetooth + push không
      chạy trên HTTP.
- [ ] Sentry DSN đã set (chỉ trong PROD build).
- [ ] Backup tự động Supabase (built-in daily, giữ 7 ngày).
- [ ] Test 1 đơn cash + 1 đơn QR thật, xác nhận HĐĐT phát hành ok.
- [ ] Privacy policy + Terms of Service (bắt buộc khi thu thập số ĐT, MST).

### Bảo mật

- [ ] Service role key của Supabase chỉ ở Edge Function, KHÔNG commit, KHÔNG
      gửi cho client.
- [ ] MISA app secret + SePay webhook secret chỉ ở Edge Function env.
- [ ] eSMS, Zalo ZNS, FPT.AI key tương tự.
- [ ] CORS Edge Function: allow domain prod, không `*`.
- [ ] Rate limit Edge Function (vd. 10 req/phút/IP cho `send-otp`).
- [ ] Webhook events lưu signature_valid → audit khi cần.

---

## 8. LƯU Ý PHÁP LÝ VIỆT NAM 2026

1. **Hộ KD doanh thu > 1 tỷ/năm BẮT BUỘC HĐĐT từ máy tính tiền có kết nối
   Tổng cục Thuế** (NĐ 70/2025, TT 32/2025, NĐ 141/2026). Không có HĐĐT =
   không bán đúng luật. **MISA meInvoice là phải làm Sprint 4, không trì hoãn.**

2. **Thuế GTGT giảm 10% → 8% đến hết 31/12/2026** (NQ 204/2025/QH15). Field
   `tax_rate` ở `products` để mở (mặc định 8, có thể nâng lại 10 từ 2027).

3. **Không tự ý phát hành HĐĐT** — phải đi qua nhà cung cấp được Tổng cục
   Thuế cấp phép. KHÔNG được build module ký số tự xây.

4. **Lưu trữ hoá đơn 10 năm** — file XML lưu Supabase Storage có versioning,
   backup S3-compatible (Cloudflare R2 / Backblaze B2) định kỳ.

5. **Nghị định 13/2023 về bảo vệ dữ liệu cá nhân:**
   - Có sự đồng ý của khách trước khi gửi ZNS/SMS marketing.
   - Số điện thoại, MST khách lưu trong order chỉ phục vụ xuất hoá đơn —
     không bán cho bên thứ 3.
   - Khi khách yêu cầu xóa, phải xóa được trong 30 ngày (trừ data bắt buộc lưu
     theo luật thuế).

6. **App "Chủ" nếu có** — không được scrape data shop khác, không được dùng
   chung database mã vạch để track giá đối thủ.

---

## 9. CẤU TRÚC FILE FINAL (gợi ý)

```
pos-tap-hoa/
├── src/
│   ├── integrations/
│   │   ├── supabase.ts
│   │   ├── auth.ts
│   │   ├── shared/
│   │   │   ├── http.ts
│   │   │   ├── errors.ts
│   │   │   └── queue.ts
│   │   ├── invoice/
│   │   │   ├── types.ts
│   │   │   ├── misa.ts
│   │   │   ├── vnpt.ts                # placeholder
│   │   │   └── index.ts
│   │   ├── payment/
│   │   │   ├── types.ts
│   │   │   ├── vietqr.ts
│   │   │   ├── sepay-types.ts          # webhook payload shape
│   │   │   └── index.ts
│   │   ├── sms/
│   │   │   ├── types.ts
│   │   │   ├── esms.ts
│   │   │   └── index.ts
│   │   ├── zalo/
│   │   │   └── zns.ts
│   │   ├── tax-lookup/
│   │   │   └── vietqr-business.ts
│   │   ├── barcode/
│   │   │   └── lookup.ts
│   │   ├── ocr/
│   │   │   └── fptai.ts
│   │   ├── stt/
│   │   │   ├── web-speech.ts
│   │   │   └── parser.ts
│   │   ├── shipping/
│   │   │   ├── ghn.ts
│   │   │   └── ahamove.ts
│   │   ├── maps/
│   │   │   └── goong.ts
│   │   ├── push/
│   │   │   └── fcm.ts
│   │   ├── printer/
│   │   │   └── bluetooth.ts
│   │   ├── ai/
│   │   │   └── anthropic.ts
│   │   └── analytics/
│   │       ├── sentry.ts
│   │       └── posthog.ts
│   ├── pages/                          # đã có
│   ├── components/                     # đã có
│   ├── stores/                         # đã có
│   ├── lib/                            # đã có
│   └── types.ts
├── supabase/
│   ├── migrations/
│   │   ├── 0001_init.sql               # tables
│   │   ├── 0002_rls.sql                # row level security
│   │   ├── 0003_shared_barcodes.sql
│   │   └── 0004_address_master.sql
│   ├── functions/
│   │   ├── sepay-webhook/
│   │   ├── issue-invoice/
│   │   ├── send-otp/
│   │   ├── send-zns/
│   │   ├── ghn-webhook/
│   │   ├── ocr-receipt/
│   │   ├── send-push/
│   │   └── ai-summary/
│   └── config.toml
├── .env.example                        # update theo section 0.2
└── docs/
    └── API_INTEGRATION_SPEC.md         # FILE NÀY
```

---

## 10. NHIỆM VỤ ĐẦU TIÊN CHO CLAUDE CODE

Khi mở session đầu tiên với spec này, làm theo thứ tự:

1. **Đọc** `CLAUDE.md` + `API_INTEGRATION_SPEC.md` (file này).
2. **Tạo** Supabase project, copy `URL` + `anon key` vào `.env.local`.
3. **Tạo** thư mục `supabase/migrations` + `supabase/functions`. Apply migration
   `0001_init.sql` (section 1.1).
4. **Cài** `@supabase/supabase-js`, tạo `src/integrations/supabase.ts`.
5. **Setup** thư mục `src/integrations/shared/` với `http.ts`, `errors.ts`,
   `queue.ts` theo skeleton ở section 0.
6. **Build** trang Đăng nhập + Google OAuth (Sprint 2).
7. **Migrate** code POS hiện tại sang dùng Supabase: products + orders.
8. **Báo cáo** trước khi sang Sprint 3.

Sau mỗi sprint, push code, deploy thử lên Caddy server, test trên điện thoại
+ desktop thật trước khi sang sprint kế tiếp.

---

> Tài liệu này là **living document**. Mỗi khi tích hợp thực, cập nhật:
> field name khớp doc chính thức, pricing thực, edge cases gặp phải, ghi chú
> "Đã verify lần cuối: YYYY-MM-DD" ở đầu section tương ứng.


