// =============================================================================
// admin-create-shop — Edge Function (Deno runtime)
// =============================================================================
// Sprint Admin SaaS: super_admin tạo shop mới + invite owner qua email.
//
// Flow:
//   1. Verify caller JWT là super_admin qua RPC is_super_admin
//   2. Call admin_create_shop RPC → tạo organization + subscription (trial)
//   3. Resolve owner user_id:
//      a. Try inviteUserByEmail (gửi magic link email)
//      b. Nếu fail (đã tồn tại / SMTP rate limit) → fallback createUser
//         (auto-confirmed, no email — admin có thể trigger password reset sau)
//      c. Nếu cả 2 fail → vẫn return org_id + warning, admin xử lý manual
//   4. Insert membership (user_id, org_id, role='owner') — service_role bypass RLS
//   5. Return { org_id, owner_user_id, invite_sent, warning? }
//
// Robustness:
//   - Mọi exception bọc try/catch top-level → return JSON error rõ ràng
//   - SMTP rate limit (Supabase free) → fallback createUser tự động
//   - Duplicate email → lookup user_id qua paginated listUsers
//
// Env vars (Supabase Dashboard auto-injects):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";

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

/**
 * Tìm user_id qua email — paginate listUsers (free tier max ~50K users,
 * pagination 1000/page → 50 calls max). Cache none vì hiếm gọi.
 */
async function findUserIdByEmail(
  adminClient: SupabaseClient,
  email: string,
): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) return null;
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < 1000) return null; // last page
  }
  return null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY",
    )!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Step 0: Verify super_admin
    const { data: isAdmin, error: adminCheckErr } = await callerClient.rpc(
      "is_super_admin",
    );
    if (adminCheckErr) {
      console.error("[admin-create-shop] admin check err:", adminCheckErr);
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
        { error: "Cần điền tên tiệm và email owner" },
        400,
      );
    }

    const adminClient = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Step 1: Create org + subscription via RPC
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
      console.error("[admin-create-shop] RPC err:", rpcErr);
      return jsonResponse(
        { error: `Tạo shop thất bại: ${rpcErr.message}` },
        500,
      );
    }
    const { org_id } = rpcResult as { org_id: string };

    // Step 2: Resolve owner user_id — 3-tier fallback
    let ownerUserId: string | null = null;
    let inviteSent = false;
    let warning: string | null = null;
    const ownerEmail = body.owner_email.trim();
    const origin = req.headers.get("origin") ?? new URL(req.url).origin;
    const redirectTo = `${origin}/login`;

    // Tier 1: inviteUserByEmail (magic link)
    const { data: invited, error: inviteErr } =
      await adminClient.auth.admin.inviteUserByEmail(ownerEmail, {
        data: { org_id_to_join: org_id },
        redirectTo,
      });

    if (!inviteErr && invited?.user) {
      ownerUserId = invited.user.id;
      inviteSent = true;
    } else {
      console.warn(
        "[admin-create-shop] invite failed, trying fallback:",
        inviteErr?.message,
      );
      // Tier 2: lookup existing user
      ownerUserId = await findUserIdByEmail(adminClient, ownerEmail);

      if (!ownerUserId) {
        // Tier 3: createUser (no email, admin trigger reset sau)
        const { data: created, error: createErr } =
          await adminClient.auth.admin.createUser({
            email: ownerEmail,
            email_confirm: true, // auto-confirm để bypass SMTP
            user_metadata: { org_id_to_join: org_id },
          });
        if (createErr || !created?.user) {
          console.error(
            "[admin-create-shop] createUser failed:",
            createErr,
          );
          return jsonResponse(
            {
              error: `Không tạo được user owner: ${
                createErr?.message ?? "unknown"
              }. Org đã tạo (id ${org_id}) nhưng owner chưa gán — admin xử lý qua Dashboard.`,
              org_id,
              warning: "owner_user_creation_failed",
            },
            500,
          );
        }
        ownerUserId = created.user.id;
        warning =
          "Owner đã tạo (auto-confirm). Liên hệ owner để họ tự reset password qua /forgot-password.";
      } else {
        warning =
          "User đã tồn tại sẵn — đã gán làm owner. Owner đăng nhập với password cũ.";
      }
    }

    // Step 3: Insert membership
    const { error: memberErr } = await adminClient
      .from("memberships")
      .insert({
        user_id: ownerUserId,
        org_id,
        role: "owner",
      });
    if (memberErr && !memberErr.message.toLowerCase().includes("duplicate")) {
      console.error("[admin-create-shop] membership err:", memberErr);
      return jsonResponse(
        {
          error: `Insert membership thất bại: ${memberErr.message}`,
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
      warning,
      message: inviteSent
        ? "Invite email đã gửi tới owner"
        : warning ?? "Owner đã gán",
    });
  } catch (err) {
    // Last-resort catch — chống 500 trống không từ runtime
    console.error("[admin-create-shop] unhandled:", err);
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: `Internal error: ${message}` }, 500);
  }
});
