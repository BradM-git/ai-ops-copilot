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
  d.setDate(d.getDate() + days);
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

function confidenceReason(exp: ExpectedRevenueRow, cadence: number | null, observedLastPaid: string | null) {
  const parts: string[] = [];
  if (!cadence) parts.push("missing cadence");
  if (!observedLastPaid) parts.push("missing last_paid_at");
  if (exp.confidence == null) parts.push("expectation confidence missing");
  if (parts.length) return parts.join(" + ");
  return "expected cadence present + last payment known";
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
    const cadence = exp.cadence_days ?? null;
    const expectedAmt = exp.expected_amount ?? null;

    const observedLastPaid = exp.last_paid_at || latestPaymentByCustomer.get(exp.customer_id)?.paid_at || null;

    if (!cadence || !observedLastPaid) {
      evals.push({
        customer_id: exp.customer_id,
        has_drift: false,
        overdue_days: null,

        expected_amount_cents: null,
        observed_amount_cents: null,
        expected_at: null,
        observed_at: observedLastPaid,

        amount_at_risk: 0,
        confidence: "low",
        confidence_reason: confidenceReason(exp, cadence, observedLastPaid),

        message: "",
        context: {
          reason: "insufficient_data_for_cadence",
          cadence_days: cadence,
          observed_last_paid_at: observedLastPaid,
          expectation_confidence: exp.confidence,
        },
      });
      continue;
    }

    const expectedBy = addDays(observedLastPaid, cadence);
    let overdueDays = daysBetween(expectedBy, nowIso);
    if (overdueDays < 0) overdueDays = 0;

    const hasDrift = overdueDays > 0;

    if (!hasDrift) {
      evals.push({
        customer_id: exp.customer_id,
        has_drift: false,
        overdue_days: 0,

        expected_amount_cents: expectedAmt,
        observed_amount_cents: expectedAmt,
        expected_at: expectedBy,
        observed_at: observedLastPaid,

        amount_at_risk: 0,
        confidence: confidenceTier(exp.confidence),
        confidence_reason: confidenceReason(exp, cadence, observedLastPaid),

        message: "",
        context: {
          cadence_days: cadence,
          expected_by: expectedBy,
          observed_last_paid_at: observedLastPaid,
          expectation_confidence: exp.confidence,
        },
      });
      continue;
    }

    const latestInv = latestInvoiceByCustomer.get(exp.customer_id) || null;

    const amountAtRisk =
      (typeof expectedAmt === "number" ? expectedAmt : null) ??
      (typeof latestInv?.amount_due === "number" ? latestInv!.amount_due! : null) ??
      0;

    const invStatus = latestInv?.status ? `Invoice ${latestInv.status}` : "No invoice status";
    const invPaid = latestInv?.paid_at ? "paid" : "unpaid";
    const confTier = confidenceTier(exp.confidence ?? null);
    const confReason = confidenceReason(exp, cadence, observedLastPaid);

    const msg = [
      `Expected payment missed (${overdueDays}d overdue)`,
      amountAtRisk ? `${fmtMoneyCents(amountAtRisk)} at risk` : null,
      invStatus ? `${invStatus} (${invPaid})` : null,
      `(confidence: ${confTier})`,
    ]
      .filter(Boolean)
      .join(" · ");

    evals.push({
      customer_id: exp.customer_id,
      has_drift: true,
      overdue_days: overdueDays,

      expected_amount_cents: amountAtRisk,
      observed_amount_cents: 0,
      expected_at: expectedBy,
      observed_at: observedLastPaid,

      amount_at_risk: amountAtRisk,
      confidence: confTier,
      confidence_reason: confReason,

      message: msg,
      context: {
        cadence_days: cadence,
        expected_by: expectedBy,
        overdue_days: overdueDays,
        observed_last_paid_at: observedLastPaid,
        expectation_confidence: exp.confidence,
        latest_invoice: latestInv
          ? {
              status: latestInv.status,
              amount_due: latestInv.amount_due,
              invoice_date: latestInv.invoice_date,
              paid_at: latestInv.paid_at,
            }
          : null,
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

            customer_id: e.customer_id, // for correct entity id population

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
        primary_entity_id: u.customer_id, // ✅ fix: never write null

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
