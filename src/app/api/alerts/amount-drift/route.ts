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

// default drift threshold (fallback)
const DEFAULT_DRIFT_PCT = 0.25;

async function getDriftThresholdPct(admin: ReturnType<typeof supabaseAdmin>, customerId: string) {
  // Uses per-customer setting if present (what you asked for), otherwise fallback.
  const { data, error } = await admin
    .from("customer_settings")
    .select("amount_drift_threshold_pct")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error || !data) return DEFAULT_DRIFT_PCT;

  const v = Number((data as any).amount_drift_threshold_pct);
  if (!Number.isFinite(v)) return DEFAULT_DRIFT_PCT;

  // clamp to sane range
  return Math.max(0.05, Math.min(1, v));
}

async function getCustomerStatus(admin: ReturnType<typeof supabaseAdmin>, customerId: string) {
  const { data, error } = await admin
    .from("customer_state")
    .select("status")
    .eq("customer_id", customerId)
    .maybeSingle();

  if (error || !data?.status) return "active";
  return String((data as any).status);
}

async function resolveSlotIfExists(admin: ReturnType<typeof supabaseAdmin>, slotId: string, patch?: any) {
  const { error } = await admin
    .from("alerts")
    .update({ status: "resolved", ...(patch || {}) })
    .eq("id", slotId);

  if (error) throw new HttpError(500, "Failed to resolve alert slot", { details: error });
}

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
    let suppressed = 0;

    for (const customerId of customerIds) {
      watched += 1;

      // Single-slot semantics: always work against the latest alert row for this customer+type (open OR resolved)
      const { data: slot, error: slotErr } = await admin
        .from("alerts")
        .select("id, status")
        .eq("customer_id", customerId)
        .eq("type", "payment_amount_drift")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (slotErr) throw new HttpError(500, "Failed to read alert slot", { details: slotErr });

      // Respect customer status (active only). If not active, ensure any slot is resolved.
      const status = await getCustomerStatus(admin, customerId);
      if (status !== "active") {
        if (slot?.id && slot.status === "open") {
          await resolveSlotIfExists(admin, slot.id, {
            confidence: "high",
            confidence_reason: `suppressed: customer not active (${status})`,
            context: { suppression_reason: "customer_status", customer_status: status },
          });
          resolved += 1;
        }
        suppressed += 1;
        continue;
      }

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
      if (paid.length < MIN_HISTORY) {
        // resolve slot if it is open
        if (slot?.id && slot.status === "open") {
          await resolveSlotIfExists(admin, slot.id);
          resolved += 1;
        }
        continue;
      }

      const observed = paid[0];

      // filter out null/invalid amounts before median
      const baselinePoolRaw = paid.slice(1, 1 + BASELINE_SAMPLE_SIZE).map((p) => p.amount);
      const baselinePool = baselinePoolRaw.filter(isNumber);

      const baseline = median(baselinePool);
      if (baseline == null || baseline <= 0 || !isNumber(observed.amount)) {
        if (slot?.id && slot.status === "open") {
          await resolveSlotIfExists(admin, slot.id);
          resolved += 1;
        }
        continue;
      }

      const driftPctThreshold = await getDriftThresholdPct(admin, customerId);

      const observedAmount = observed.amount;
      const diff = Math.abs(observedAmount - baseline);
      const pct = diff / baseline;

      if (pct < driftPctThreshold) {
        // no drift -> resolve slot if open (and update context so we know it cleared)
        if (slot?.id && slot.status === "open") {
          await resolveSlotIfExists(admin, slot.id, {
            observed_at: observed.paid_at,
            context: {
              expected_amount_cents: baseline,
              observed_amount_cents: observedAmount,
              baseline_sample_size: baselinePool.length,
              threshold_pct: driftPctThreshold,
            },
          });
          resolved += 1;
        }
        continue;
      }

      // drift detected -> open slot (update latest row if exists, else insert first-ever row)
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
        confidence_reason: `Observed differs from baseline by ${Math.round(pct * 100)}% (threshold ${Math.round(
          driftPctThreshold * 100
        )}%).`,
        expected_at: null,
        observed_at: observed.paid_at,
        context: {
          expected_amount_cents: baseline,
          observed_amount_cents: observedAmount,
          baseline_sample_size: baselinePool.length,
          baseline_amounts: baselinePool,
          observed_payment_id: observed.id,
          threshold_pct: driftPctThreshold,
        },
      };

      if (slot?.id) {
        const { error: uErr } = await admin.from("alerts").update(payload).eq("id", slot.id);
        if (uErr) throw new HttpError(500, "Failed to update alert slot", { details: uErr });
        updated += 1;
      } else {
        const { error: iErr } = await admin.from("alerts").insert(payload);
        if (iErr) throw new HttpError(500, "Failed to create alert", { details: iErr });
        created += 1;
      }
    }

    return jsonOk({ ok: true, watched, created, updated, resolved, suppressed });
  } catch (err) {
    return jsonErr(err);
  }
}
