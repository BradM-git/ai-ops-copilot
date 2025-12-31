// src/app/api/logic/customer-defaults/route.ts
import { HttpError, jsonErr, jsonOk, requireEnv } from "@/lib/api";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabaseAdmin() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

/**
 * Ensures every customer has:
 * - customer_settings row
 * - customer_state row
 *
 * IMPORTANT: Only inserts missing rows (never overwrites).
 */
export async function GET() {
  try {
    const admin = supabaseAdmin();

    const { data: customers, error: cErr } = await admin
      .from("customers")
      .select("id")
      .order("created_at", { ascending: true });

    if (cErr) throw new HttpError(500, "Failed to load customers", { details: cErr });

    const ids = (customers || []).map((c: any) => c.id).filter(Boolean);
    if (ids.length === 0) return jsonOk({ ok: true, customers: 0, inserted_settings: 0, inserted_state: 0 });

    const [{ data: existingSettings, error: sErr }, { data: existingState, error: stErr }] = await Promise.all([
      admin.from("customer_settings").select("customer_id").in("customer_id", ids),
      admin.from("customer_state").select("customer_id").in("customer_id", ids),
    ]);

    if (sErr) throw new HttpError(500, "Failed to read customer_settings", { details: sErr });
    if (stErr) throw new HttpError(500, "Failed to read customer_state", { details: stErr });

    const haveSettings = new Set((existingSettings || []).map((r: any) => r.customer_id));
    const haveState = new Set((existingState || []).map((r: any) => r.customer_id));

    const now = new Date().toISOString();

    const missingSettings = ids
      .filter((id) => !haveSettings.has(id))
      .map((id) => ({
        customer_id: id,
        missed_payment_grace_days: 2,
        missed_payment_low_conf_cutoff: 0.5,
        missed_payment_low_conf_min_risk_cents: 500000,
        amount_drift_threshold_pct: 0.25,
        jira_activity_lookback: "7d",
        updated_at: now,
      }));

    const missingState = ids
      .filter((id) => !haveState.has(id))
      .map((id) => ({
        customer_id: id,
        status: "active",
        reason: null,
        updated_at: now,
      }));

    let inserted_settings = 0;
    let inserted_state = 0;

    if (missingSettings.length > 0) {
      const { error } = await admin.from("customer_settings").insert(missingSettings);
      // If another request inserted first, ignore duplicate-key
      if (error && (error as any).code !== "23505") throw new HttpError(500, "Failed to insert customer_settings defaults", { details: error });
      if (!error) inserted_settings = missingSettings.length;
    }

    if (missingState.length > 0) {
      const { error } = await admin.from("customer_state").insert(missingState);
      if (error && (error as any).code !== "23505") throw new HttpError(500, "Failed to insert customer_state defaults", { details: error });
      if (!error) inserted_state = missingState.length;
    }

    return jsonOk({
      ok: true,
      customers: ids.length,
      inserted_settings,
      inserted_state,
    });
  } catch (err) {
    return jsonErr(err);
  }
}
