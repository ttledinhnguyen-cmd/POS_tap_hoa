// =============================================================================
// admin-create-shop — Edge Function (Deno runtime)
// =============================================================================
// Sprint Admin SaaS: super_admin tạo shop mới + invite owner qua email.
//
// Flow:
//   1. Verify caller JWT là super_admin (query super_admins table với caller's
//      access token — RLS gate đảm bảo only admin xem được)
//   2. Call admin_create_shop RPC → tạo organization + subscription (trial),
//      return { org_id, owner_email }
//   3. supabase.auth.admin.inviteUserByEmail(owner_email) — service_role
//      → user nhận email với link set password
//   4. Insert membership (user_id, org_id, role='owner') — service_role bypass RLS
//   5. Return { org_id, owner_user_id, invite_sent: true }
//
// Error handling:
//   - Email đã có user: skip invite, vẫn add membership cho user existing
//   - RPC fail (org name dup, etc.): bubble up
//
// Env vars (set qua Supabase Dashboard → Edge Functions):
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - SUPABASE_SERVICE_ROLE_KEY
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";

interface CreateShopBody {
  org_name: string;
  owner_email: string;
  tax_code?: string;
  address?: string;
  address_full?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  trial_days?: number;
  monthly_price?: number;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Missing Authorization header" }, 401);
  }

  // Caller-scoped client để verify is_super_admin RPC qua RLS
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: isAdmin, error: adminCheckErr } = await callerClient.rpc(
    "is_super_admin",
  );
  if (adminCheckErr) {
    return jsonResponse(
      { error: `Admin check failed: ${adminCheckErr.message}` },
      500,
    );
  }
  if (!isAdmin) {
    return jsonResponse({ error: "Forbidden: super_admin only" }, 403);
  }

  // Parse body
  let body: CreateShopBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (!body.org_name?.trim() || !body.owner_email?.trim()) {
    return jsonResponse(
      { error: "org_name + owner_email required" },
      400,
    );
  }

  // Service-role client cho inviteUserByEmail + insert membership
  const adminClient = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Step 1: Call admin_create_shop RPC qua caller (RPC tự verify is_super_admin)
  const { data: rpcResult, error: rpcErr } = await callerClient.rpc(
    "admin_create_shop",
    {
      p_org_name: body.org_name.trim(),
      p_owner_email: body.owner_email.trim(),
      p_tax_code: body.tax_code ?? null,
      p_address: body.address ?? null,
      p_address_full: body.address_full ?? null,
      p_phone: body.phone ?? null,
      p_latitude: body.latitude ?? null,
      p_longitude: body.longitude ?? null,
      p_trial_days: body.trial_days ?? 30,
      p_monthly_price: body.monthly_price ?? 199000,
    },
  );
  if (rpcErr) {
    return jsonResponse(
      { error: `Create shop RPC failed: ${rpcErr.message}` },
      500,
    );
  }
  const { org_id } = rpcResult as { org_id: string };

  // Step 2: Invite user (hoặc lookup existing user)
  let ownerUserId: string | null = null;
  let inviteSent = false;
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const redirectTo = `${origin}/login`;

  const { data: invited, error: inviteErr } =
    await adminClient.auth.admin.inviteUserByEmail(body.owner_email.trim(), {
      data: { org_id_to_join: org_id },
      redirectTo,
    });
  if (inviteErr) {
    // User đã tồn tại — lookup id qua admin.listUsers (filter email)
    const { data: list, error: listErr } = await adminClient.auth.admin.listUsers(
      { perPage: 1000 },
    );
    if (listErr) {
      return jsonResponse(
        {
          error: `Invite failed and lookup failed: ${inviteErr.message} / ${listErr.message}`,
          org_id,
        },
        500,
      );
    }
    const existing = list.users.find(
      (u) => u.email?.toLowerCase() === body.owner_email.trim().toLowerCase(),
    );
    if (!existing) {
      return jsonResponse(
        {
          error: `Invite failed: ${inviteErr.message}`,
          org_id,
        },
        500,
      );
    }
    ownerUserId = existing.id;
  } else {
    ownerUserId = invited.user.id;
    inviteSent = true;
  }

  // Step 3: Insert membership với service_role (bypass RLS)
  const { error: memberErr } = await adminClient
    .from("memberships")
    .insert({
      user_id: ownerUserId,
      org_id,
      role: "owner",
    });
  if (memberErr && !memberErr.message.includes("duplicate")) {
    return jsonResponse(
      {
        error: `Membership insert failed: ${memberErr.message}`,
        org_id,
        owner_user_id: ownerUserId,
      },
      500,
    );
  }

  return jsonResponse({
    org_id,
    owner_user_id: ownerUserId,
    invite_sent: inviteSent,
    message: inviteSent
      ? "Invite email đã gửi tới owner"
      : "User đã có sẵn, đã gán làm owner",
  });
});
