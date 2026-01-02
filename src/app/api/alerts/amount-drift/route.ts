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

    const { data: customers, error: custErr } = await supabase
      .from("customers")
      .select("id,name,is_active");

    if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });

    const activeCustomers = (customers || []).filter((c) => c.is_active !== false);

    for (const c of activeCustomers) {
      const { data: settings, error: setErr } = await supabase
        .from("customer_settings")
        .select("amount_drift_threshold_pct")
        .eq("customer_id", c.id)
        .maybeSingle();

      if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

      const thresholdPct = settings?.amount_drift_threshold_pct ?? 25;

      const { data: invoices, error: invErr } = await supabase
        .from("stripe_invoices")
        .select("id,amount_due_cents,amount_paid_cents,status")
        .eq("customer_id", c.id);

      if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

      // Example drift condition: paid differs from due by threshold
      const drifted = (invoices || []).filter((i) => {
        const due = i.amount_due_cents ?? 0;
        const paid = i.amount_paid_cents ?? 0;
        if (due === 0) return false;
        const diffPct = Math.abs((paid - due) / due) * 100;
        return diffPct >= thresholdPct;
      });

      const title = "Payment amount drift";
      const description =
        drifted.length === 0
          ? "No invoices show amount drift."
          : `${drifted.length} invoice(s) show amount drift beyond ${thresholdPct}%.`;

      const amountAtRisk = drifted.reduce((sum, i) => sum + (i.amount_due_cents ?? 0), 0);

      const actions =
        drifted.length === 0
          ? []
          : drifted.slice(0, 10).map((i) => ({
              label: `Open invoice ${String(i.id).slice(0, 6)}…`,
              url: `https://dashboard.stripe.com/invoices/${i.id}`,
            }));

      const payload = {
        customer_id: c.id,
        type: "payment_amount_drift",
        provider: "stripe",
        title,
        description,
        status: drifted.length === 0 ? "ok" : "issue",
        severity: drifted.length === 0 ? "info" : "high",
        count: drifted.length,
        amount_at_risk_cents: amountAtRisk,
        actions,
        last_run_at: new Date().toISOString(),
      };

      const { data: existing, error: existErr } = await supabase
        .from("alerts")
        .select("id")
        .eq("customer_id", c.id)
        .eq("type", "payment_amount_drift")
        .maybeSingle();

      if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });

      if (existing?.id) {
        const { error: updErr } = await supabase.from("alerts").update(payload).eq("id", existing.id);
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
      } else {
        const { error: insErr } = await supabase.from("alerts").insert(payload);
        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
