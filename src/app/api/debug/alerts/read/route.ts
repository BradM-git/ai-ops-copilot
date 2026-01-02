// src/app/api/debug/alerts/read/route.ts
import { jsonErr, jsonOk, requireEnv } from "@/lib/api";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

function supabaseAdmin() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    // Auth-gate
    const supabase = await supabaseServer();
    const { data: userRes } = await supabase.auth.getUser();
    if (!userRes.user) return jsonOk({ ok: false, error: "Unauthorized" }, { status: 401 });

    const admin = supabaseAdmin();

    // Resolve customer_id using admin (bypass RLS)
    const { data: memberships, error: memErr } = await admin
      .from("customer_memberships")
      .select("customer_id")
      .eq("user_id", userRes.user.id);

    if (memErr) return jsonOk({ ok: false, error: memErr.message }, { status: 500 });
    if (!memberships || memberships.length !== 1) {
      return jsonOk({ ok: false, error: "No customer membership" }, { status: 400 });
    }

    const customerId = memberships[0].customer_id as string;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return jsonOk({ ok: false, error: "missing id" }, { status: 400 });

    const { data, error } = await admin
      .from("alerts")
      .select("*")
      .eq("id", id)
      .eq("customer_id", customerId)
      .maybeSingle();

    if (error) return jsonOk({ ok: false, error }, { status: 500 });
    return jsonOk({ ok: true, alert: data });
  } catch (e) {
    return jsonErr(e);
  }
}
