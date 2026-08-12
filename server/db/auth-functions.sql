-- =============================================================================
-- auth-functions.sql — Luồng xác thực, chạy dưới quyền ipos_owner
-- =============================================================================
-- users, refresh_tokens, auth_tokens KHÔNG có policy RLS cho ipos_app (cố ý),
-- nên API không đọc thẳng được. Mọi thao tác đăng nhập đi qua các function ở
-- đây — SECURITY DEFINER nên chạy dưới quyền ipos_owner và bỏ qua RLS.
--
-- VÌ SAO KHÔNG cấp `GRANT ipos_owner TO ipos_app` rồi `SET ROLE`:
-- làm vậy thì ipos_app tự nâng quyền thành owner bất cứ lúc nào, và toàn bộ
-- ranh giới RLS dựng ở schema.sql thành vô nghĩa. Giới hạn ở đúng những
-- function cần thiết thì bề mặt tấn công nhỏ và kiểm tra được.
--
-- Token luôn lưu HASH, không lưu bản gốc: lộ DB cũng không dựng lại được phiên.
-- =============================================================================

create or replace function public.auth_find_user_by_email(p_email text)
returns table (id uuid, email text, password_hash text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.email, u.password_hash
  from public.users u
  where lower(u.email) = lower(btrim(p_email))
  limit 1
$$;

create or replace function public.auth_create_user(
  p_email         text,
  p_password_hash text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_clean text := lower(btrim(p_email));
begin
  if v_clean = '' or v_clean not like '%_@_%._%' then
    raise exception 'Email không hợp lệ';
  end if;
  if exists (select 1 from public.users where lower(email) = v_clean) then
    raise exception 'Email đã được dùng' using errcode = 'unique_violation';
  end if;

  insert into public.users (email, password_hash)
  values (v_clean, p_password_hash)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.auth_record_sign_in(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.users set last_sign_in_at = now() where id = p_user_id
$$;

create or replace function public.auth_set_password(
  p_user_id       uuid,
  p_password_hash text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users set password_hash = p_password_hash where id = p_user_id;
  -- Đổi mật khẩu = đá mọi phiên đang mở trên thiết bị khác
  update public.refresh_tokens
  set revoked_at = now()
  where user_id = p_user_id and revoked_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Refresh token
-- -----------------------------------------------------------------------------
create or replace function public.auth_store_refresh(
  p_user_id    uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_user_agent text default null
) returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.refresh_tokens (user_id, token_hash, expires_at, user_agent)
  values (p_user_id, p_token_hash, p_expires_at, left(coalesce(p_user_agent, ''), 300))
  returning id
$$;

-- Xoay vòng: kiểm tra token cũ còn hiệu lực → thu hồi → phát token mới, tất cả
-- trong một transaction. Trả về user_id, hoặc NULL nếu token sai/hết hạn/đã dùng.
--
-- Token đã thu hồi mà bị dùng lại là dấu hiệu bị đánh cắp → thu hồi TOÀN BỘ
-- phiên của user đó. Đây là cách phát hiện trộm token tiêu chuẩn.
create or replace function public.auth_rotate_refresh(
  p_old_hash   text,
  p_new_hash   text,
  p_expires_at timestamptz,
  p_user_agent text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    record;
  v_new_id uuid;
begin
  select id, user_id, expires_at, revoked_at into v_row
  from public.refresh_tokens where token_hash = p_old_hash;

  if v_row.id is null then
    return null;
  end if;

  if v_row.revoked_at is not null then
    -- Token đã thu hồi bị dùng lại → nghi bị đánh cắp, đá sạch mọi phiên
    update public.refresh_tokens
    set revoked_at = now()
    where user_id = v_row.user_id and revoked_at is null;
    return null;
  end if;

  if v_row.expires_at <= now() then
    return null;
  end if;

  insert into public.refresh_tokens (user_id, token_hash, expires_at, user_agent)
  values (v_row.user_id, p_new_hash, p_expires_at, left(coalesce(p_user_agent, ''), 300))
  returning id into v_new_id;

  update public.refresh_tokens
  set revoked_at = now(), replaced_by = v_new_id
  where id = v_row.id;

  return v_row.user_id;
end;
$$;

create or replace function public.auth_revoke_refresh(p_token_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.refresh_tokens
  set revoked_at = now()
  where token_hash = p_token_hash and revoked_at is null
$$;

create or replace function public.auth_revoke_all(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.refresh_tokens
  set revoked_at = now()
  where user_id = p_user_id and revoked_at is null
$$;

-- -----------------------------------------------------------------------------
-- Token một lần: reset mật khẩu, mời chủ shop
-- -----------------------------------------------------------------------------
create or replace function public.auth_create_onetime_token(
  p_user_id    uuid,
  p_token_hash text,
  p_purpose    text,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Chỉ cho một token còn hiệu lực mỗi mục đích: xin link mới làm link cũ chết
  update public.auth_tokens
  set used_at = now()
  where user_id = p_user_id and purpose = p_purpose and used_at is null;

  insert into public.auth_tokens (user_id, token_hash, purpose, expires_at)
  values (p_user_id, p_token_hash, p_purpose, p_expires_at)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.auth_consume_onetime_token(
  p_token_hash text,
  p_purpose    text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select id, user_id, expires_at, used_at into v_row
  from public.auth_tokens
  where token_hash = p_token_hash and purpose = p_purpose;

  if v_row.id is null or v_row.used_at is not null or v_row.expires_at <= now() then
    return null;
  end if;

  update public.auth_tokens set used_at = now() where id = v_row.id;
  return v_row.user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ngữ cảnh phiên cho GET /api/auth/me
-- -----------------------------------------------------------------------------
-- Gộp một lần gọi: thông tin user + danh sách tiệm kèm vai trò + cờ super_admin
-- + subscription của từng tiệm. Client cần đủ ngần đó để dựng AuthGuard.
create or replace function public.auth_user_context(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'user', (
      select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', u.created_at)
      from public.users u where u.id = p_user_id
    ),
    'is_super_admin', exists(select 1 from public.super_admins where user_id = p_user_id),
    'organizations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'tax_code', o.tax_code,
          'address', o.address,
          'phone', o.phone,
          'role', m.role,
          'subscription', case when s.id is null then null else jsonb_build_object(
            'status', s.status,
            'tier', s.tier,
            'trial_until_date', s.trial_until_date,
            'paid_until_date', s.paid_until_date,
            'monthly_price', s.monthly_price
          ) end
        )
        order by m.created_at
      )
      from public.memberships m
      join public.organizations o on o.id = m.org_id
      left join public.subscriptions s on s.org_id = o.id
      where m.user_id = p_user_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Gắn chủ shop vào tiệm vừa tạo (thay phần Edge Function admin-create-shop làm)
-- -----------------------------------------------------------------------------
-- Tìm user theo email, chưa có thì tạo với mật khẩu ngẫu nhiên do tầng API băm
-- sẵn (chủ shop sẽ đặt lại qua link mời), rồi gắn làm owner của tiệm.
--
-- Chỉ super_admin gọi được — kiểm tra ngay trong hàm vì SECURITY DEFINER bỏ
-- qua RLS.
create or replace function public.admin_attach_owner(
  p_org_id        uuid,
  p_email         text,
  p_password_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_created boolean := false;
  v_clean   text := lower(btrim(p_email));
begin
  if not public.is_super_admin() then
    raise exception 'Forbidden: super_admin only';
  end if;
  if v_clean = '' or v_clean not like '%_@_%._%' then
    raise exception 'Email không hợp lệ';
  end if;

  select id into v_user_id from public.users where lower(email) = v_clean;

  if v_user_id is null then
    insert into public.users (email, password_hash)
    values (v_clean, p_password_hash)
    returning id into v_user_id;
    v_created := true;
  end if;

  insert into public.memberships (user_id, org_id, role)
  values (v_user_id, p_org_id, 'owner')
  on conflict (user_id, org_id) do nothing;

  return jsonb_build_object('user_id', v_user_id, 'created', v_created);
end;
$$;
