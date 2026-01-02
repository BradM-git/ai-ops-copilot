import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireCron } from "@/lib/api";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function daysBetween(a: Date, b: Date) {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export async function GET(req: Request) {
  try {
    requireCron(req);

    const supabase = supabaseAdmin();

    const { data: customers, error: custErr } = await supabase.from("customers").select("id,name");
    if (custErr) return NextResponse.json({ error: custErr.message }, { status: 500 });

    const eligibleCustomers = customers || [];
    const now = new Date();

    let created = 0;
    let updated = 0;
    let resolved = 0;

    for (const c of eligibleCustomers) {
      // Latest settings row (if multiple)
      const { data: settings, error: settingsErr } = await supabase
        .from("customer_settings")
        .select("missed_payment_grace_days, updated_at")
        .eq("customer_id", c.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (settingsErr) return NextResponse.json({ error: settingsErr.message }, { status: 500 });

      const graceDays = (settings as any)?.missed_payment_grace_days ?? 5;

      // ✅ Upstream expectation source for this alert type
      const { data: exp, error: expErr } = await supabase
        .from("expected_revenue")
        .select("customer_id, cadence_days, expected_amount, last_paid_at, created_at")
        .eq("customer_id", c.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 });

      const alertType = "missed_expected_payment";
      const sourceSystem = "stripe"; // placeholder label for alpha

      // If no expectation configured, close any open alerts of this type (defensive)
      if (!exp) {
        const { data: openRows, error: openErr } = await supabase
          .from("alerts")
          .select("id")
          .eq("customer_id", c.id)
          .eq("type", alertType)
          .eq("status", "open");

        if (openErr) return NextResponse.json({ error: openErr.message }, { status: 500 });

        const openCount = (openRows || []).length;
        if (openCount > 0) {
          const { error: closeErr } = await supabase
            .from("alerts")
            .update({
              status: "closed",
              message: "No expected_revenue configured for this customer.",
              amount_at_risk: 0,
              source_system: sourceSystem,
              primary_entity_type: null,
              primary_entity_id: null,
              context: { reason: "missing_expected_revenue" },
              confidence: null,
              confidence_reason: null,
              expected_amount_cents: null,
              observed_amount_cents: null,
              expected_at: null,
              observed_at: null,
            })
            .eq("customer_id", c.id)
            .eq("type", alertType)
            .eq("status", "open");

          if (closeErr) return NextResponse.json({ error: closeErr.message }, { status: 500 });
          resolved += openCount;
        }
        continue;
      }

      const cadenceDays = Number((exp as any).cadence_days ?? 0);
      if (!cadenceDays || cadenceDays <= 0) {
        // nothing sensible to compute
        continue;
      }

      const basePaidAt = (exp as any).last_paid_at
        ? new Date((exp as any).last_paid_at)
        : new Date((exp as any).created_at);

      const dueAt = addDays(basePaidAt, cadenceDays);
      const daysPastDue = daysBetween(now, dueAt);
      const isMissed = daysPastDue >= graceDays;

      const expectedAmount = Number((exp as any).expected_amount ?? 0);
      const amountAtRisk = isMissed ? expectedAmount : 0;

      // Optional: grab latest invoice for context + deep link id if present
      const { data: latestInv, error: invErr } = await supabase
        .from("invoices")
        .select("id, stripe_invoice_id, amount_due, status, invoice_date")
        .eq("customer_id", c.id)
        .order("invoice_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

      const primaryEntityType = latestInv ? "invoice" : null;
      const primaryEntityId = latestInv
        ? String((latestInv as any).stripe_invoice_id || (latestInv as any).id || "")
        : null;

      const message = isMissed
        ? `Payment expected but not received (${daysPastDue} day(s) past due beyond grace).`
        : "Payments are tracking to expectation.";

      const context = {
        cadence_days: cadenceDays,
        grace_days: graceDays,
        expected_amount: expectedAmount,
        last_paid_at: basePaidAt.toISOString(),
        due_at: dueAt.toISOString(),
        days_past_due: daysPastDue,
        latest_invoice: latestInv
          ? {
              id: (latestInv as any).id,
              stripe_invoice_id: (latestInv as any).stripe_invoice_id ?? null,
              amount_due: (latestInv as any).amount_due ?? null,
              invoice_date: (latestInv as any).invoice_date ?? null,
              status: (latestInv as any).status ?? null,
            }
          : null,
      };

      const nextStatus = isMissed ? "open" : "closed";

      const payload: any = {
        customer_id: c.id,
        type: alertType,
        message,
        status: nextStatus,
        amount_at_risk: amountAtRisk,
        source_system: sourceSystem,
        primary_entity_type: primaryEntityType,
        primary_entity_id: primaryEntityId,
        context,
        confidence: null,
        confidence_reason: null,
        expected_amount_cents: null,
        observed_amount_cents: null,
        expected_at: null,
        observed_at: null,
      };

      // ✅ If closing, close ALL open duplicates (prevents zombie rows)
      if (nextStatus === "closed") {
        const { data: openRows, error: openErr } = await supabase
          .from("alerts")
          .select("id")
          .eq("customer_id", c.id)
          .eq("type", alertType)
          .eq("status", "open");

        if (openErr) return NextResponse.json({ error: openErr.message }, { status: 500 });

        const openCount = (openRows || []).length;
        if (openCount > 0) {
          const { error: closeErr } = await supabase
            .from("alerts")
            .update(payload)
            .eq("customer_id", c.id)
            .eq("type", alertType)
            .eq("status", "open");

          if (closeErr) return NextResponse.json({ error: closeErr.message }, { status: 500 });
          resolved += openCount;
        } else {
          updated += 1;
        }

        continue;
      }

      // Otherwise: update latest row or insert
      const { data: existing, error: existErr } = await supabase
        .from("alerts")
        .select("id")
        .eq("customer_id", c.id)
        .eq("type", alertType)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });

      if (existing?.id) {
        const { error: updErr } = await supabase.from("alerts").update(payload).eq("id", existing.id);
        if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
        updated += 1;
      } else {
        const { error: insErr } = await supabase.from("alerts").insert(payload);
        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
        created += 1;
      }
    }

    return NextResponse.json({ ok: true, created, updated, resolved });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "error" }, { status: 500 });
  }
}
