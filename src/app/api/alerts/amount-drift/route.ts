// src/app/api/alerts/amount-drift/route.ts
import { HttpError, jsonErr, jsonOk, requireEnv } from "@/lib/api";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function supabaseAdmin() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// small helper so TS knows nulls are removed
function isNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

const BASELINE_SAMPLE_SIZE = 6;
const MIN_HISTORY = 4;
// drift threshold (example: 25% difference) — keep whatever you already had if different
const DRIFT_PCT = 0.25;

export async function POST(req: Request) {
  try {
    const admin = supabaseAdmin();

    // Latest payment history per customer
    const { data: customers, error: cErr } = await admin
      .from("customers")
      .select("id")
      .order("created_at", { ascending: true });

    if (cErr) throw new HttpError(500, "Failed to load customers", { details: cErr });
    const customerIds = (customers || []).map((c: any) => c.id).filter(Boolean);

    let watched = 0;
    let created = 0;
    let updated = 0;
    let resolved = 0;

    for (const customerId of customerIds) {
      watched += 1;

      // get latest payments (paid_at desc)
      const { data: payRows, error: pErr } = await admin
        .from("payments")
        .select("id, customer_id, amount, paid_at")
        .eq("customer_id", customerId)
        .order("paid_at", { ascending: false })
        .limit(20);

      if (pErr) throw new HttpError(500, "Failed to load payments", { details: pErr });

      const paid = (payRows || []).filter((p: any) => p?.paid_at) as Array<{
        id: string;
        customer_id: string;
        amount: number | null;
        paid_at: string;
      }>;

      // need enough history
      // NOTE: allow amounts null in rows, but we’ll filter them before median calc
      if (paid.length < MIN_HISTORY) {
        // resolve any existing open alert for this customer
        const { data: existing, error: eErr } = await admin
          .from("alerts")
          .select("id, status")
          .eq("customer_id", customerId)
          .eq("type", "payment_amount_drift")
          .eq("status", "open")
          .maybeSingle();

        if (eErr) throw new HttpError(500, "Failed to read existing alert", { details: eErr });

        if (existing?.id) {
          const { error: rErr } = await admin
            .from("alerts")
            .update({ status: "resolved" })
            .eq("id", existing.id);
          if (rErr) throw new HttpError(500, "Failed to resolve alert", { details: rErr });
          resolved += 1;
        }
        continue;
      }

      const observed = paid[0];

      // ✅ FIX: filter out null/invalid amounts before median
      const baselinePoolRaw = paid
        .slice(1, 1 + BASELINE_SAMPLE_SIZE)
        .map((p) => p.amount);

      const baselinePool = baselinePoolRaw.filter(isNumber);

      // If we can’t compute a baseline reliably, resolve existing and move on
      const baseline = median(baselinePool);
      if (baseline == null || baseline <= 0 || !isNumber(observed.amount)) {
        const { data: existing, error: eErr } = await admin
          .from("alerts")
          .select("id, status")
          .eq("customer_id", customerId)
          .eq("type", "payment_amount_drift")
          .eq("status", "open")
          .maybeSingle();

        if (eErr) throw new HttpError(500, "Failed to read existing alert", { details: eErr });

        if (existing?.id) {
          const { error: rErr } = await admin
            .from("alerts")
            .update({ status: "resolved" })
            .eq("id", existing.id);
          if (rErr) throw new HttpError(500, "Failed to resolve alert", { details: rErr });
          resolved += 1;
        }
        continue;
      }

      const observedAmount = observed.amount;
      const diff = Math.abs(observedAmount - baseline);
      const pct = diff / baseline;

      // find any existing open alert
      const { data: existing, error: eErr } = await admin
        .from("alerts")
        .select("id, status")
        .eq("customer_id", customerId)
        .eq("type", "payment_amount_drift")
        .eq("status", "open")
        .maybeSingle();

      if (eErr) throw new HttpError(500, "Failed to read existing alert", { details: eErr });

      if (pct < DRIFT_PCT) {
        // no drift -> resolve existing if open
        if (existing?.id) {
          const { error: rErr } = await admin
            .from("alerts")
            .update({
              status: "resolved",
              observed_at: observed.paid_at,
              context: {
                expected_amount_cents: baseline,
                observed_amount_cents: observedAmount,
                baseline_sample_size: baselinePool.length,
              },
            })
            .eq("id", existing.id);

          if (rErr) throw new HttpError(500, "Failed to resolve alert", { details: rErr });
          resolved += 1;
        }
        continue;
      }

      // drift detected -> create or update alert
      const amountAtRisk = diff; // cents
      const payload = {
        customer_id: customerId,
        type: "payment_amount_drift",
        status: "open",
        message: `Payment amount deviates from historical norm.`,
        amount_at_risk: amountAtRisk,
        source_system: "stripe",
        primary_entity_type: "customer",
        primary_entity_id: customerId,
        confidence: "medium" as const,
        confidence_reason: `Observed differs from baseline by ${Math.round(pct * 100)}%.`,
        expected_amount_cents: baseline,
        observed_amount_cents: observedAmount,
        expected_at: null,
        observed_at: observed.paid_at,
        context: {
          baseline_sample_size: baselinePool.length,
          baseline_amounts: baselinePool, // already numbers only
          observed_payment_id: observed.id,
        },
      };

      if (existing?.id) {
        const { error: uErr } = await admin.from("alerts").update(payload).eq("id", existing.id);
        if (uErr) throw new HttpError(500, "Failed to update alert", { details: uErr });
        updated += 1;
      } else {
        const { error: iErr } = await admin.from("alerts").insert(payload);
        if (iErr) throw new HttpError(500, "Failed to create alert", { details: iErr });
        created += 1;
      }
    }

    return jsonOk({ ok: true, watched, created, updated, resolved });
  } catch (err) {
    return jsonErr(err);
  }
}
