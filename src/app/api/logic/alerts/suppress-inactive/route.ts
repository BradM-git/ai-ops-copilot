// src/app/api/logic/alerts/suppress-inactive/route.ts
import { HttpError, jsonErr, jsonOk, requireEnv } from "@/lib/api";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabaseAdmin() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/**
 * Resolves ALL open client alerts for customers whose status != active.
 * (integration_error alerts have customer_id NULL so are unaffected)
 */
export async function POST() {
  try {
    const admin = supabaseAdmin();

    const { data: inactive, error: stErr } = await admin
      .from("customer_state")
      .select("customer_id, status, reason")
      .neq("status", "active");

    if (stErr) throw new HttpError(500, "Failed to read customer_state", { details: stErr });

    const rows = (inactive || []) as Array<{ customer_id: string; status: string; reason: string | null }>;
    if (rows.length === 0) {
      return jsonOk({ ok: true, inactive_customers: 0, resolved_alerts: 0 });
    }

    const ids = rows.map((r) => r.customer_id);

    // Resolve all open alerts for those customers.
    // We intentionally do NOT attempt to count affected rows (Supabase typings vary).
    const now = new Date().toISOString();

    const { error: updErr } = await admin
      .from("alerts")
      .update({
        status: "resolved",
        confidence: "high",
        confidence_reason: `suppressed: customer not active (${now})`,
        context: { suppression_reason: "customer_status" },
      })
      .eq("status", "open")
      .in("customer_id", ids);

    if (updErr) throw new HttpError(500, "Failed to resolve alerts for inactive customers", { details: updErr });

    return jsonOk({
      ok: true,
      inactive_customers: ids.length,
      resolved_alerts: "unknown",
      note: "All open alerts for non-active customers were resolved. Exact count omitted due to client limitations.",
    });
  } catch (err) {
    return jsonErr(err);
  }
}
