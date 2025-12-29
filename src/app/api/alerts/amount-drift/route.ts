// src/app/api/logic/alerts/amount-drift/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function fmtMoneyCents(n: number) {
  return (n / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

type PaymentRow = {
  id: string;
  customer_id: string;
  amount: number | null; // cents
  paid_at: string | null;
};

type ExpectedRevenueRow = {
  customer_id: string;
  confidence: number | null; // 0..1
};

type AlertRow = {
  id: string;
  customer_id: string;
  type: string;
  status: string;
  message: string | null;
  amount_at_risk: number | null;
};

function median(nums: number[]) {
  if (nums.length === 0) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 0 ? Math.round((a[mid - 1] + a[mid]) / 2) : a[mid];
}

function confidenceTier(conf: number | null): "high" | "medium" | "low" {
  if (conf == null) return "medium";
  if (conf >= 0.8) return "high";
  if (conf >= 0.5) return "medium";
  return "low";
}

// Defaults are intentionally conservative (trust before breadth).
const MIN_HISTORY_PAYMENTS = 4; // observed + 3 baseline
const BASELINE_SAMPLE_SIZE = 6; // use up to this many payments for baseline (excluding most recent)
const MIN_ABS_DRIFT_CENTS = 5_000; // $50
const MIN_PCT_DRIFT = 0.25; // 25%

export async function POST() {
  const admin = supabaseAdmin();

  // Wedge domain: revenue integrity. We scope monitoring to customers that have an expectation row.
  const { data: expRaw, error: expErr } = await admin.from("expected_revenue").select("customer_id, confidence");
  if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 });
  const expRows = (expRaw || []) as ExpectedRevenueRow[];
  if (expRows.length === 0) return NextResponse.json({ ok: true, watched: 0, created: 0, updated: 0, resolved: 0 });

  const customerIds = expRows.map((r) => r.customer_id);
  const expByCustomer = new Map(expRows.map((r) => [r.customer_id, r]));

  const { data: payRaw, error: payErr } = await admin
    .from("payments")
    .select("id, customer_id, amount, paid_at")
    .in("customer_id", customerIds)
    .order("paid_at", { ascending: false })
    .limit(2000);
  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

  const payments = (payRaw || []) as PaymentRow[];
  const paymentsByCustomer = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    if (!paymentsByCustomer.has(p.customer_id)) paymentsByCustomer.set(p.customer_id, []);
    paymentsByCustomer.get(p.customer_id)!.push(p);
  }

  const ALERT_TYPE = "payment_amount_drift";

  const { data: openAlertsRaw, error: openAlertsErr } = await admin
    .from("alerts")
    .select("id, customer_id, type, status, message, amount_at_risk")
    .eq("status", "open")
    .eq("type", ALERT_TYPE)
    .in("customer_id", customerIds);
  if (openAlertsErr) return NextResponse.json({ error: openAlertsErr.message }, { status: 500 });
  const openAlerts = (openAlertsRaw || []) as AlertRow[];
  const openAlertByCustomer = new Map(openAlerts.map((a) => [a.customer_id, a]));

  const toResolve: string[] = [];
  const toCreate: any[] = [];
  const toUpdate: any[] = [];

  for (const customerId of customerIds) {
    const list = paymentsByCustomer.get(customerId) || [];
    const paid = list.filter((p) => p.paid_at && typeof p.amount === "number") as Array<
      Required<Pick<PaymentRow, "id" | "customer_id" | "paid_at" | "amount">>
    >;

    const existing = openAlertByCustomer.get(customerId) || null;

    if (paid.length < MIN_HISTORY_PAYMENTS) {
      if (existing) toResolve.push(existing.id);
      continue;
    }

    // Payments are already ordered DESC by paid_at because of the query/order.
    const observed = paid[0];
    const baselinePool = paid.slice(1, 1 + BASELINE_SAMPLE_SIZE).map((p) => p.amount);
    const baseline = median(baselinePool);

    if (!baseline || baseline <= 0) {
      if (existing) toResolve.push(existing.id);
      continue;
    }

    const delta = Math.abs(observed.amount - baseline);
    const pct = delta / baseline;

    const hasDrift = delta >= MIN_ABS_DRIFT_CENTS && pct >= MIN_PCT_DRIFT;

    if (!hasDrift) {
      if (existing) toResolve.push(existing.id);
      continue;
    }

    const expConf = expByCustomer.get(customerId)?.confidence ?? null;
    const confTier = confidenceTier(expConf);
    const confReason = `baseline from ${Math.min(BASELINE_SAMPLE_SIZE, baselinePool.length)} prior payments`;

    const direction = observed.amount < baseline ? "lower" : "higher";
    const pctRounded = Math.round(pct * 100);
    const msg = [
      `Payment amount ${direction} than norm`,
      `${fmtMoneyCents(observed.amount)} observed`,
      `~${fmtMoneyCents(baseline)} expected`,
      `${pctRounded}%`,
      `${fmtMoneyCents(delta)} delta`,
    ].join(" · ");

    const payload = {
      customer_id: customerId,
      type: ALERT_TYPE,
      status: "open",
      message: msg,
      amount_at_risk: delta,

      source_system: "stripe",
      primary_entity_type: "customer",
      primary_entity_id: customerId,

      confidence: confTier,
      confidence_reason: confReason,

      expected_amount_cents: baseline,
      observed_amount_cents: observed.amount,
      expected_at: observed.paid_at,
      observed_at: observed.paid_at,

      context: {
        baseline_sample_size: baselinePool.length,
        baseline_amounts_cents: baselinePool,
        baseline_median_cents: baseline,
        observed_payment_id: observed.id,
        observed_amount_cents: observed.amount,
        observed_paid_at: observed.paid_at,
        delta_cents: delta,
        pct_drift: pct,
        thresholds: {
          min_abs_drift_cents: MIN_ABS_DRIFT_CENTS,
          min_pct_drift: MIN_PCT_DRIFT,
        },
      },
    };

    if (!existing) {
      toCreate.push(payload);
    } else {
      const existingAmt = Number(existing.amount_at_risk ?? 0);
      if ((existing.message || "") !== msg || existingAmt !== delta) {
        toUpdate.push({ id: existing.id, ...payload });
      }
    }
  }

  let created = 0;
  let resolved = 0;
  let updated = 0;

  if (toResolve.length > 0) {
    const { error: rErr } = await admin.from("alerts").update({ status: "resolved" }).in("id", toResolve);
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
    resolved = toResolve.length;
  }

  if (toCreate.length > 0) {
    const { error: cErr } = await admin.from("alerts").insert(toCreate);
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    created = toCreate.length;
  }

  for (const u of toUpdate) {
    const { error: uErr } = await admin
      .from("alerts")
      .update({
        message: u.message,
        amount_at_risk: u.amount_at_risk,
        source_system: "stripe",
        primary_entity_type: "customer",
        primary_entity_id: u.customer_id,
        confidence: u.confidence,
        confidence_reason: u.confidence_reason,
        expected_amount_cents: u.expected_amount_cents,
        observed_amount_cents: u.observed_amount_cents,
        expected_at: u.expected_at,
        observed_at: u.observed_at,
        context: u.context,
      })
      .eq("id", u.id);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    updated += 1;
  }

  return NextResponse.json({ ok: true, watched: customerIds.length, created, updated, resolved });
}
