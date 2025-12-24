// src/app/api/logic/alerts/missed/route.ts
import { createClient } from "@supabase/supabase-js";
import { HttpError, jsonErr, jsonOk, requireEnv } from "@/lib/api";

export const runtime = "nodejs";

function getSupabase() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient(url, key);
}

const DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const supabase = getSupabase();

    const { data: exp, error: expErr } = await supabase
      .from("expected_revenue")
      .select("customer_id,cadence_days,expected_amount,last_paid_at,confidence");

    if (expErr) {
      throw new HttpError(500, "Supabase read expected_revenue failed", {
        code: "SUPABASE_READ_EXPECTED_REVENUE_FAILED",
        details: expErr,
      });
    }

    if (!exp?.length) return jsonOk({ alerts_created: 0, message: "no expected_revenue" });

    const now = Date.now();
    let created = 0;
    let skippedNotOverdue = 0;
    let skippedHasNewerPaid = 0;
    let skippedAlreadyOpen = 0;

    for (const e of exp as any[]) {
      if (!e.customer_id) continue;

      const last = e.last_paid_at ? new Date(e.last_paid_at).getTime() : null;
      if (!last) continue;

      const cadenceDays = Number(e.cadence_days ?? 30);
      const dueAt = last + cadenceDays * DAY;

      // only alert if overdue by 3+ days (reduces noise)
      if (now < dueAt + 3 * DAY) {
        skippedNotOverdue++;
        continue;
      }

      // if there is a paid invoice after last_paid_at, skip
      const { data: newerPaid, error: newerErr } = await supabase
        .from("invoices")
        .select("id")
        .eq("customer_id", e.customer_id)
        .not("paid_at", "is", null)
        .gt("paid_at", e.last_paid_at)
        .limit(1);

      if (newerErr) {
        throw new HttpError(500, "Supabase read invoices (newer paid) failed", {
          code: "SUPABASE_READ_INVOICES_NEWER_PAID_FAILED",
          details: newerErr,
        });
      }

      if (newerPaid && newerPaid.length > 0) {
        skippedHasNewerPaid++;
        continue;
      }

      // avoid duplicates (open)
      const { data: existing, error: exErr } = await supabase
        .from("alerts")
        .select("id")
        .eq("customer_id", e.customer_id)
        .eq("type", "missed_expected_payment")
        .eq("status", "open")
        .limit(1);

      if (exErr) {
        throw new HttpError(500, "Supabase read alerts (existing) failed", {
          code: "SUPABASE_READ_ALERTS_EXISTING_FAILED",
          details: exErr,
        });
      }

      if (existing && existing.length > 0) {
        skippedAlreadyOpen++;
        continue;
      }

      const dollars = e.expected_amount ? Math.round(Number(e.expected_amount) / 100) : 0;
      const lastDate = new Date(last).toISOString().slice(0, 10);

      const msg = `Likely missed ~$${dollars} after ${lastDate} (every ${cadenceDays}d).`;

      const { error: insErr } = await supabase.from("alerts").insert({
        customer_id: e.customer_id,
        type: "missed_expected_payment",
        message: msg,
        amount_at_risk: e.expected_amount ?? null,
        status: "open",
      });

      if (insErr) {
        throw new HttpError(500, "Supabase insert alert failed", {
          code: "SUPABASE_INSERT_ALERT_FAILED",
          details: insErr,
        });
      }

      created++;
    }

    return jsonOk({
      alerts_created: created,
      skippedNotOverdue,
      skippedHasNewerPaid,
      skippedAlreadyOpen,
    });
  } catch (err) {
    return jsonErr(err);
  }
}
