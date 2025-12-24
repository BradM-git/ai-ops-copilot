// src/app/api/logic/alerts/missed/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// Your schema (from screenshot) strongly suggests amounts are stored as cents (int8).
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
  expected_amount: number | null;
  last_paid_at: string | null;
  confidence: number | null; // float
};

type PaymentRow = {
  customer_id: string;
  amount: number | null;
  paid_at: string | null;
};

type InvoiceRow = {
  customer_id: string;
  amount_due: number | null;
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
  amount_at_risk: number; // cents
  message: string;
};

function confidenceLabel(conf: number | null) {
  if (conf == null) return "confidence unknown";
  if (conf >= 0.8) return "high confidence";
  if (conf >= 0.5) return "medium confidence";
  return "low confidence";
}

export async function POST() {
  const admin = supabaseAdmin();

  // 1) Pull expectation rows (these define which customers we can watch)
  const { data: expRaw, error: expErr } = await admin
    .from("expected_revenue")
    .select("customer_id, cadence_days, expected_amount, last_paid_at, confidence");

  if (expErr) {
    return NextResponse.json({ error: expErr.message }, { status: 500 });
  }

  const expRows = (expRaw || []) as ExpectedRevenueRow[];

  // If no expectations exist, nothing to do (quiet; no fake alerts)
  if (expRows.length === 0) {
    return NextResponse.json({ ok: true, watched: 0, created: 0, resolved: 0, updated: 0 });
  }

  const customerIds = expRows.map((r) => r.customer_id);

  // 2) Pull latest payment per customer (for observed reality)
  const { data: payRaw, error: payErr } = await admin
    .from("payments")
    .select("customer_id, amount, paid_at")
    .in("customer_id", customerIds)
    .order("paid_at", { ascending: false });

  if (payErr) {
    return NextResponse.json({ error: payErr.message }, { status: 500 });
  }

  const payments = (payRaw || []) as PaymentRow[];
  const latestPaymentByCustomer = new Map<string, PaymentRow>();
  for (const p of payments) {
    if (!latestPaymentByCustomer.has(p.customer_id)) latestPaymentByCustomer.set(p.customer_id, p);
  }

  // 3) Pull latest invoice per customer (supporting observation)
  const { data: invRaw, error: invErr } = await admin
    .from("invoices")
    .select("customer_id, amount_due, status, invoice_date, paid_at")
    .in("customer_id", customerIds)
    .order("invoice_date", { ascending: false });

  if (invErr) {
    return NextResponse.json({ error: invErr.message }, { status: 500 });
  }

  const invoices = (invRaw || []) as InvoiceRow[];
  const latestInvoiceByCustomer = new Map<string, InvoiceRow>();
  for (const inv of invoices) {
    if (!latestInvoiceByCustomer.has(inv.customer_id)) latestInvoiceByCustomer.set(inv.customer_id, inv);
  }

  // 4) Pull open alerts of this type (so we can create/resolve without duplication)
  const ALERT_TYPE = "missed_expected_payment";

  const { data: openAlertsRaw, error: openAlertsErr } = await admin
    .from("alerts")
    .select("id, customer_id, type, status, message, amount_at_risk, created_at")
    .eq("status", "open")
    .eq("type", ALERT_TYPE)
    .in("customer_id", customerIds);

  if (openAlertsErr) {
    return NextResponse.json({ error: openAlertsErr.message }, { status: 500 });
  }

  const openAlerts = (openAlertsRaw || []) as AlertRow[];
  const openAlertByCustomer = new Map<string, AlertRow>();
  for (const a of openAlerts) openAlertByCustomer.set(a.customer_id, a);

  // 5) Evaluate drift per customer
  const nowIso = new Date().toISOString();
  const evals: DriftEval[] = [];

  for (const exp of expRows) {
    const cadence = exp.cadence_days ?? null;
    const expectedAmt = exp.expected_amount ?? null;

    // “Last paid” comes from expectation inference, but if missing we can fall back to latest payment.
    const observedLastPaid = exp.last_paid_at || latestPaymentByCustomer.get(exp.customer_id)?.paid_at || null;

    // If we don’t have cadence or last_paid_at, we can’t confidently detect missed cadence.
    // (Trust before breadth: do NOT alert.)
    if (!cadence || !observedLastPaid) {
      evals.push({
        customer_id: exp.customer_id,
        has_drift: false,
        overdue_days: null,
        amount_at_risk: 0,
        message: "",
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
        amount_at_risk: 0,
        message: "",
      });
      continue;
    }

    // Amount at risk: prefer expected_amount; else invoice amount_due; else fall back to 0
    const latestInv = latestInvoiceByCustomer.get(exp.customer_id) || null;
    const amountAtRisk =
      (typeof expectedAmt === "number" ? expectedAmt : null) ??
      (typeof latestInv?.amount_due === "number" ? latestInv!.amount_due! : null) ??
      0;

    const invStatus = latestInv?.status ? `Invoice ${latestInv.status}` : "No invoice status";
    const invPaid = latestInv?.paid_at ? "paid" : "unpaid";
    const conf = confidenceLabel(exp.confidence ?? null);

    // Keep message short, factual, and action-oriented.
    const msg = [
      `Expected payment missed (${overdueDays}d overdue)`,
      amountAtRisk ? `${fmtMoneyCents(amountAtRisk)} at risk` : null,
      invStatus ? `${invStatus} (${invPaid})` : null,
      `(${conf})`,
    ]
      .filter(Boolean)
      .join(" · ");

    evals.push({
      customer_id: exp.customer_id,
      has_drift: true,
      overdue_days: overdueDays,
      amount_at_risk: amountAtRisk,
      message: msg,
    });
  }

  // 6) Create / resolve / optionally update
  const toResolve: string[] = [];
  const toCreate: Array<{
    customer_id: string;
    type: string;
    status: string;
    message: string;
    amount_at_risk: number;
  }> = [];
  const toUpdate: Array<{ id: string; message: string; amount_at_risk: number }> = [];

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
        });
      } else {
        // Optional: keep the open alert’s message/amount current (still no noise; same alert)
        const existingAmt = Number(existing.amount_at_risk ?? 0);
        if ((existing.message || "") !== e.message || existingAmt !== e.amount_at_risk) {
          toUpdate.push({ id: existing.id, message: e.message, amount_at_risk: e.amount_at_risk });
        }
      }
    } else {
      if (existing) {
        toResolve.push(existing.id);
      }
    }
  }

  let created = 0;
  let resolved = 0;
  let updated = 0;

  if (toResolve.length > 0) {
    const { error: rErr } = await admin
      .from("alerts")
      .update({ status: "resolved" })
      .in("id", toResolve);

    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
    resolved = toResolve.length;
  }

  if (toCreate.length > 0) {
    const { error: cErr } = await admin.from("alerts").insert(toCreate);
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
    created = toCreate.length;
  }

  // Update individually (simple + safe for MVP). If you want batch RPC later, we can.
  for (const u of toUpdate) {
    const { error: uErr } = await admin
      .from("alerts")
      .update({ message: u.message, amount_at_risk: u.amount_at_risk })
      .eq("id", u.id);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    updated += 1;
  }

  return NextResponse.json({
    ok: true,
    watched: expRows.length,
    created,
    updated,
    resolved,
  });
}
