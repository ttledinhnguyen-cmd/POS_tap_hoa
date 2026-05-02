-- =============================================================================
-- 0011_shared_barcodes.sql — Kho mã vạch dùng chung (community moat)
-- =============================================================================
-- Public read + authenticated contribute. Mọi shop quét EAN → tìm trong kho
-- này → name/brand/image/unit auto-prefill. Giá KHÔNG lưu (bí mật mỗi shop).
--
-- Network effect: càng nhiều user → kho data càng giàu → đối thủ khó copy.
-- Hàng VN nội địa nhỏ (Hảo Hảo, gói gia vị) sẽ chỉ có ở đây vì OFF không có.
--
-- Moderation defer: is_verified flag schema-only, admin UI ở phase sau.
-- =============================================================================

create table public.shared_barcodes (
  barcode             text primary key,
  name                text not null,
  brand               text,
  category            text,
  default_unit        text default 'cái',
  image_url           text,
  contributor_count   int not null default 1,
  first_seen_at       timestamptz not null default now(),
  last_updated_at     timestamptz not null default now(),
  is_verified         boolean not null default false
);

-- Index brand cho future "tìm sản phẩm theo brand" (defer)
create index shared_barcodes_brand_idx on public.shared_barcodes(brand)
  where brand is not null;

alter table public.shared_barcodes enable row level security;

-- PUBLIC READ — kể cả anonymous (preview demo, future use case)
create policy shared_barcodes_read on public.shared_barcodes
  for select
  using (true);

-- AUTHENTICATED WRITE — qua RPC chỉ. Direct insert/update KHÔNG cho phép
-- (RPC có validation barcode format + trim spaces).
-- Không có policy modify nào → block direct mutate. RPC security definer
-- bypass RLS bằng grant.
-- (Không cần policy modify vì RPC dùng security definer.)

-- -----------------------------------------------------------------------------
-- RPC contribute_barcode — upsert + counter
-- -----------------------------------------------------------------------------
create or replace function public.contribute_barcode(
  p_barcode      text,
  p_name         text,
  p_brand        text default null,
  p_image_url    text default null,
  p_default_unit text default 'cái'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text := regexp_replace(coalesce(p_barcode, ''), '\s', '', 'g');
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated';
  end if;

  -- Validate barcode format: 8-14 digits
  if not v_clean ~ '^\d{8,14}$' then
    raise exception 'Invalid barcode format: %', v_clean;
  end if;

  -- Validate name không rỗng
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Name required';
  end if;

  -- Upsert: insert mới với counter=1, hoặc update + increment counter.
  -- KHÔNG track per-user contribution (defer khi cần chính xác — bảng phụ
  -- shared_barcodes_contributors). Hiện tại counter mỗi lần gọi → reflects
  -- "lần encounter" hơn là "unique contributors". OK cho MVP.
  insert into public.shared_barcodes (
    barcode, name, brand, default_unit, image_url
  ) values (
    v_clean,
    trim(p_name),
    nullif(trim(coalesce(p_brand, '')), ''),
    coalesce(nullif(trim(p_default_unit), ''), 'cái'),
    nullif(trim(coalesce(p_image_url, '')), '')
  )
  on conflict (barcode) do update set
    -- Chỉ update nếu field cũ rỗng + field mới có (preserve existing data)
    name              = coalesce(nullif(public.shared_barcodes.name, ''), excluded.name),
    brand             = coalesce(public.shared_barcodes.brand, excluded.brand),
    image_url         = coalesce(public.shared_barcodes.image_url, excluded.image_url),
    default_unit      = coalesce(public.shared_barcodes.default_unit, excluded.default_unit),
    contributor_count = public.shared_barcodes.contributor_count + 1,
    last_updated_at   = now();
end;
$$;

revoke all on function public.contribute_barcode(text, text, text, text, text) from public;
grant execute on function public.contribute_barcode(text, text, text, text, text) to authenticated;
