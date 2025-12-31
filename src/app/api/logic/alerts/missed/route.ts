// src/app/api/logic/alerts/missed/route.ts
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

function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function daysBetween(fromISO: string, toISO: string) {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  const ms = to - from;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

type ExpectedRevenueRow = {
  customer_id: string;
  cadence_days: number | null;
  expected_amount: number | null; // cents
  last_paid_at: string | null;
  confidence: number | null; // float 0..1
};

type PaymentRow = {
  customer_id: string;
  amount: number | null; // cents
  paid_at: string | null;
};

type InvoiceRow = {
  customer_id: string;
  amount_due: number | null; // cents
  status: string | null;
  invoice_date: string | null;
  paid_at: string | null;
};

type AlertRow = {
  id: string;
  customer_id: string;
  type: string;
  status: string;
  message: string | null;
  amount_at_risk: number | null;
  created_at: string;
};

type CustomerSettings = {
  customer_id: string;
  missed_payment_grace_days: number;
  missed_payment_low_conf_cutoff: number;
  missed_payment_low_conf_min_risk_cents: number;
};

type CustomerState = {
  customer_id: string;
  status: string; // active|onboarding|paused|inactive
  reason: string | null;
};

type DriftEval = {
  customer_id: string;

  has_drift: boolean;
  overdue_days: number | null;

  expected_amount_cents: number | null;
  observed_amount_cents: number | null;
  expected_at: string | null;
  observed_at: string | null;

  amount_at_risk: number; // cents
  confidence: "high" | "medium" | "low";
  confidence_reason: string;

  message: string;

  context: Record<string, any>;
};

function confidenceTier(conf: number | null): "high" | "medium" | "low" {
  if (conf == null) return "medium";
  if (conf >= 0.8) return "high";
  if (conf >= 0.5) return "medium";
  return "low";
}

function paymentEvidence(payments: PaymentRow[], customerId: string) {
  let count = 0;
  let first: number | null = null;
  let last: number | null = null;

  for (const p of payments) {
    if (p.customer_id !== customerId) continue;
    if (!p.paid_at) continue;
    const t = new Date(p.paid_at).getTime();
    if (!Number.isFinite(t)) continue;
    count += 1;
    if (first == null || t < first) first = t;
    if (last == null || t > last) last = t;
  }

  const spanDays = first != null && last != null ? Math.floor((last - first) / (1000 * 60 * 60 * 24)) : null;

  return {
    count,
    spanDays,
    first_paid_at: first != null ? new Date(first).toISOString() : null,
    last_paid_at: last != null ? new Date(last).toISOString() : null,
  };
}

function confidenceReason(exp: ExpectedRevenueRow, cadence: number | null, observedLastPaid: string | null, ev: any) {
  const tier = confidenceTier(exp.confidence ?? null);
  const confTxt = exp.confidence == null ? "unknown" : String(exp.confidence);
  const parts: string[] = [];
  parts.push(`tier=${tier} (model_conf=${confTxt})`);
  parts.push(cadence ? `cadence=${cadence}d` : "cadence=missing");
  parts.push(observedLastPaid ? `last_paid_at=${new Date(observedLastPaid).toISOString()}` : "last_paid_at=missing");
  parts.push(`payments_seen=${ev.count}`);
  if (ev.spanDays != null && ev.count >= 2) parts.push(`history_span=${ev.spanDays}d`);
  return parts.join(" · ");
}

function isActive(state: CustomerState | null) {
  const s = (state?.status || "active").toLowerCase();
  return s === "active";
}

export async function POST() {
  const admin = supabaseAdmin();

  const { data: expRaw, error: expErr } = await admin
    .from("expected_revenue")
    .select("customer_id, cadence_days, expected_amount, last_paid_at, confidence");

  if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 });

  const expRows = (expRaw || []) as ExpectedRevenueRow[];
  if (expRows.length === 0) {
    return NextResponse.json({ ok: true, watched: 0, created: 0, resolved: 0, updated: 0 });
  }

  const customerIds = expRows.map((r) => r.customer_id);

  const { data: settingsRaw } = await admin
    .from("customer_settings")
    .select("customer_id, missed_payment_grace_days, missed_payment_low_conf_cutoff, missed_payment_low_conf_min_risk_cents")
    .in("customer_id", customerIds);

  const { data: stateRaw } = await admin.from("customer_state").select("customer_id, status, reason").in("customer_id", customerIds);

  const settingsById = new Map((settingsRaw || []).map((s: any) => [s.customer_id, s as CustomerSettings]));
  const stateById = new Map((stateRaw || []).map((s: any) => [s.customer_id, s as CustomerState]));

  const { data: payRaw, error: payErr } = await admin
    .from("payments")
    .select("customer_id, amount, paid_at")
    .in("customer_id", customerIds)
    .order("paid_at", { ascending: false });

  if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

  const payments = (payRaw || []) as PaymentRow[];
  const latestPaymentByCustomer = new Map<string, PaymentRow>();
  for (const p of payments) {
    if (!latestPaymentByCustomer.has(p.customer_id)) latestPaymentByCustomer.set(p.customer_id, p);
  }

  const { data: invRaw, error: invErr } = await admin
    .from("invoices")
    .select("customer_id, amount_due, status, invoice_date, paid_at")
    .in("customer_id", customerIds)
    .order("invoice_date", { ascending: false });

  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

  const invoices = (invRaw || []) as InvoiceRow[];
  const latestInvoiceByCustomer = new Map<string, InvoiceRow>();
  for (const inv of invoices) {
    if (!latestInvoiceByCustomer.has(inv.customer_id)) latestInvoiceByCustomer.set(inv.customer_id, inv);
  }

  const ALERT_TYPE = "missed_expected_payment";

  const { data: openAlertsRaw, error: openAlertsErr } = await admin
    .from("alerts")
    .select("id, customer_id, type, status, message, amount_at_risk, created_at")
    .eq("status", "open")
    .eq("type", ALERT_TYPE)
    .in("customer_id", customerIds);

  if (openAlertsErr) return NextResponse.json({ error: openAlertsErr.message }, { status: 500 });

  const openAlerts = (openAlertsRaw || []) as AlertRow[];
  const openAlertByCustomer = new Map<string, AlertRow>();
  for (const a of openAlerts) openAlertByCustomer.set(a.customer_id, a);

  const nowIso = new Date().toISOString();
  const evals: DriftEval[] = [];

  for (const exp of expRows) {
    const customerId = exp.customer_id;
    const state = stateById.get(customerId) || null;
    const s = settingsById.get(customerId) || null;

    // Defaults (opinionated) if missing rows
    const graceDays = s?.missed_payment_grace_days ?? 2;
    const lowConfCutoff = s?.missed_payment_low_conf_cutoff ?? 0.5;
    const lowConfMinRisk = s?.missed_payment_low_conf_min_risk_cents ?? 500000;

    // Suppress if client is not active
    if (!isActive(state)) {
      evals.push({
        customer_id: customerId,
        has_drift: false,
        overdue_days: null,
        expected_amount_cents: null,
        observed_amount_cents: null,
        expected_at: null,
        observed_at: exp.last_paid_at || null,
        amount_at_risk: 0,
        confidence: "high",
        confidence_reason: `suppressed: customer_status=${state?.status || "unknown"}${state?.reason ? ` (${state.reason})` : ""}`,
        message: "",
        context: { suppression_reason: "customer_status", customer_status: state?.status, customer_reason: state?.reason || null },
      });
      continue;
    }

    const cadence = exp.cadence_days ?? null;
    const expectedAmt = exp.expected_amount ?? null;

    const observedLastPaid = exp.last_paid_at || latestPaymentByCustomer.get(customerId)?.paid_at || null;
    const ev = paymentEvidence(payments, customerId);

    if (!cadence || !observedLastPaid) {
      evals.push({
        customer_id: customerId,
        has_drift: false,
        overdue_days: null,
        expected_amount_cents: null,
        observed_amount_cents: null,
        expected_at: null,
        observed_at: observedLastPaid,
        amount_at_risk: 0,
        confidence: "low",
        confidence_reason: confidenceReason(exp, cadence, observedLastPaid, ev),
        message: "",
        context: {
          reason: "insufficient_data_for_cadence",
          cadence_days: cadence,
          observed_last_paid_at: observedLastPaid,
          expectation_confidence: exp.confidence,
          payment_evidence: ev,
          settings: { grace_days: graceDays, low_conf_cutoff: lowConfCutoff, low_conf_min_risk_cents: lowConfMinRisk },
        },
      });
      continue;
    }

    const expectedBy = addDays(observedLastPaid, cadence);
    const graceUntil = addDays(expectedBy, graceDays);

    let overdueDays = daysBetween(graceUntil, nowIso);
    if (overdueDays < 0) overdueDays = 0;

    let hasDrift = overdueDays > 0;

    const latestInv = latestInvoiceByCustomer.get(customerId) || null;

    const amountAtRisk =
      (typeof expectedAmt === "number" ? expectedAmt : null) ??
      (typeof latestInv?.amount_due === "number" ? latestInv!.amount_due! : null) ??
      0;

    // Suppress low-confidence expectations unless stakes are huge
    if (hasDrift && (exp.confidence ?? 1) < lowConfCutoff && amountAtRisk < lowConfMinRisk) {
      hasDrift = false;
    }

    if (!hasDrift) {
      evals.push({
        customer_id: customerId,
        has_drift: false,
        overdue_days: 0,
        expected_amount_cents: expectedAmt,
        observed_amount_cents: expectedAmt,
        expected_at: expectedBy,
        observed_at: observedLastPaid,
        amount_at_risk: 0,
        confidence: confidenceTier(exp.confidence),
        confidence_reason:
          (exp.confidence ?? 1) < lowConfCutoff && amountAtRisk < lowConfMinRisk
            ? `suppressed (low-confidence expectation, not huge risk) · ${confidenceReason(exp, cadence, observedLastPaid, ev)}`
            : confidenceReason(exp, cadence, observedLastPaid, ev),
        message: "",
        context: {
          grace_days: graceDays,
          grace_until: graceUntil,
          cadence_days: cadence,
          expected_by: expectedBy,
          observed_last_paid_at: observedLastPaid,
          expectation_confidence: exp.confidence,
          payment_evidence: ev,
          suppression:
            (exp.confidence ?? 1) < lowConfCutoff && amountAtRisk < lowConfMinRisk
              ? {
                  reason: "low_confidence_not_huge_risk",
                  amount_at_risk_cents: amountAtRisk,
                  min_amount_at_risk_cents: lowConfMinRisk,
                  cutoff: lowConfCutoff,
                }
              : null,
          latest_invoice: latestInv
            ? { status: latestInv.status, amount_due: latestInv.amount_due, invoice_date: latestInv.invoice_date, paid_at: latestInv.paid_at }
            : null,
          settings: { grace_days: graceDays, low_conf_cutoff: lowConfCutoff, low_conf_min_risk_cents: lowConfMinRisk },
        },
      });
      continue;
    }

    const invStatus = latestInv?.status ? `Invoice ${latestInv.status}` : "No invoice status";
    const invPaid = latestInv?.paid_at ? "paid" : "unpaid";
    const confTier = confidenceTier(exp.confidence ?? null);

    const msg = [
      `Expected payment missed (grace ${graceDays}d, now ${overdueDays}d overdue)`,
      amountAtRisk ? `${fmtMoneyCents(amountAtRisk)} at risk` : null,
      invStatus ? `${invStatus} (${invPaid})` : null,
      `(confidence: ${confTier})`,
    ]
      .filter(Boolean)
      .join(" · ");

    evals.push({
      customer_id: customerId,
      has_drift: true,
      overdue_days: overdueDays,
      expected_amount_cents: amountAtRisk,
      observed_amount_cents: 0,
      expected_at: expectedBy,
      observed_at: observedLastPaid,
      amount_at_risk: amountAtRisk,
      confidence: confTier,
      confidence_reason: confidenceReason(exp, cadence, observedLastPaid, ev),
      message: msg,
      context: {
        grace_days: graceDays,
        grace_until: graceUntil,
        cadence_days: cadence,
        expected_by: expectedBy,
        overdue_days: overdueDays,
        observed_last_paid_at: observedLastPaid,
        expectation_confidence: exp.confidence,
        payment_evidence: ev,
        latest_invoice: latestInv
          ? { status: latestInv.status, amount_due: latestInv.amount_due, invoice_date: latestInv.invoice_date, paid_at: latestInv.paid_at }
          : null,
        settings: { grace_days: graceDays, low_conf_cutoff: lowConfCutoff, low_conf_min_risk_cents: lowConfMinRisk },
      },
    });
  }

  const toResolve: string[] = [];
  const toCreate: Array<any> = [];
  const toUpdate: Array<any> = [];

  for (const e of evals) {
    const existing = openAlertByCustomer.get(e.customer_id) || null;

    if (e.has_drift) {
      if (!existing) {
        toCreate.push({
          customer_id: e.customer_id,
          type: ALERT_TYPE,
          status: "open",
          message: e.message,
          amount_at_risk: e.amount_at_risk,
          source_system: "stripe",
          primary_entity_type: "customer",
          primary_entity_id: e.customer_id,
          confidence: e.confidence,
          confidence_reason: e.confidence_reason,
          expected_amount_cents: e.expected_amount_cents,
          observed_amount_cents: e.observed_amount_cents,
          expected_at: e.expected_at,
          observed_at: e.observed_at,
          context: e.context,
        });
      } else {
        const existingAmt = Number(existing.amount_at_risk ?? 0);
        if ((existing.message || "") !== e.message || existingAmt !== e.amount_at_risk) {
          toUpdate.push({
            id: existing.id,
            message: e.message,
            amount_at_risk: e.amount_at_risk,
            customer_id: e.customer_id,
            confidence: e.confidence,
            confidence_reason: e.confidence_reason,
            expected_amount_cents: e.expected_amount_cents,
            observed_amount_cents: e.observed_amount_cents,
            expected_at: e.expected_at,
            observed_at: e.observed_at,
            context: e.context,
          });
        }
      }
    } else {
      if (existing) toResolve.push(existing.id);
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
    // If dedupe index triggers under concurrency, treat as safe-noise (another run already created it).
    if (cErr && (cErr as any).code !== "23505") return NextResponse.json({ error: cErr.message }, { status: 500 });
    if (!cErr) created = toCreate.length;
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

  return NextResponse.json({ ok: true, watched: expRows.length, created, updated, resolved });
}
