import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCron } from "@/lib/api";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    requireCron(req);

    const supabase = supabaseAdmin();

    // Ensure every customer has a settings row
    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("id");

    if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });

    for (const c of customers || []) {
      const { data: settings, error: setErr } = await supabase
        .from("customer_settings")
        .select("customer_id")
        .eq("customer_id", c.id)
        .maybeSingle();

      if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

      if (!settings) {
        const { error: insErr } = await supabase
          .from("customer_settings")
          .insert({
            customer_id: c.id,
            missed_payment_grace_days: 5,
            missed_payment_low_conf_cutoff: 50,
            missed_payment_low_conf_min_risk_cents: 50000,
            amount_drift_threshold_pct: 25,
            jira_activity_lookback: "14 days",
          });

        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
