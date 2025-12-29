// src/app/page.tsx
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import CloseAlertButton from "@/components/CloseAlertButton";
import {
  presentAlert,
  type AlertRow,
  type CustomerRow,
  type ExpectedRevenueRow,
  type InvoiceRow,
  type PaymentRow,
  type Severity,
} from "@/lib/alertRegistry";

export const dynamic = "force-dynamic";

function severityFromScore(score: number): Severity {
  if (score >= 280) return "critical";
  if (score >= 200) return "high";
  return "medium";
}

export default async function HomePage() {
  // Alerts (open only) — ordered by created_at desc initially; registry scoring reorders after enrichment
  const { data: alertsRaw, error: alertsErr } = await supabase
    .from("alerts")
    .select(
      "id, customer_id, type, message, amount_at_risk, status, created_at, source_system, primary_entity_type, primary_entity_id, confidence, confidence_reason, expected_amount_cents, observed_amount_cents, expected_at, observed_at, context"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);

  if (alertsErr) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Attention</h1>
        <p className="mt-3 text-sm text-slate-700">Failed to load alerts: {alertsErr.message}</p>
      </main>
    );
  }

  // ✅ FIX: cast through unknown to satisfy TS (Supabase types can be “too wide”)
  const alerts = ((alertsRaw || []) as unknown) as AlertRow[];

  const customerIds = Array.from(new Set(alerts.map((a) => a.customer_id))).filter(Boolean);

  // Customers
  const { data: customersRaw } = await supabase
    .from("customers")
    .select("id, account_id, stripe_customer_id, name, email, created_at")
    .in("id", customerIds);

  const customers = ((customersRaw || []) as unknown) as CustomerRow[];
  const customersById = new Map(customers.map((c) => [c.id, c]));

  // Expected revenue
  const { data: expectedRaw } = await supabase
    .from("expected_revenue")
    .select("id, customer_id, cadence_days, expected_amount, last_paid_at, confidence, created_at")
    .in("customer_id", customerIds);

  const expectedRows = ((expectedRaw || []) as unknown) as ExpectedRevenueRow[];
  const expectedByCustomer = new Map(expectedRows.map((e) => [e.customer_id, e]));

  // Latest invoice per customer (cheap approximation: order by invoice_date desc then take first per customer)
  const { data: invoicesRaw } = await supabase
    .from("invoices")
    .select("id, customer_id, stripe_invoice_id, amount_due, status, invoice_date, paid_at, created_at")
    .in("customer_id", customerIds)
    .order("invoice_date", { ascending: false });

  const invoices = ((invoicesRaw || []) as unknown) as InvoiceRow[];
  const latestInvoiceByCustomer = new Map<string, InvoiceRow>();
  for (const inv of invoices) {
    if (!latestInvoiceByCustomer.has(inv.customer_id)) latestInvoiceByCustomer.set(inv.customer_id, inv);
  }

  // Latest payment per customer
  const { data: paymentsRaw } = await supabase
    .from("payments")
    .select("id, customer_id, stripe_payment_intent_id, amount, paid_at, created_at")
    .in("customer_id", customerIds)
    .order("paid_at", { ascending: false });

  const payments = ((paymentsRaw || []) as unknown) as PaymentRow[];
  const latestPaymentByCustomer = new Map<string, PaymentRow>();
  for (const p of payments) {
    if (!latestPaymentByCustomer.has(p.customer_id)) latestPaymentByCustomer.set(p.customer_id, p);
  }

  // Present + score (registry)
  const presented = alerts.map((a) => {
    const cust = customersById.get(a.customer_id) || null;
    const exp = expectedByCustomer.get(a.customer_id) || null;
    const inv = latestInvoiceByCustomer.get(a.customer_id) || null;
    const pay = latestPaymentByCustomer.get(a.customer_id) || null;

    // overdueDays is only meaningful for “missed expected payment”; keep null for others unless you compute later
    const overdueDays: number | null = null;

    // Start with medium; score function + confidence/impact will lift it
    const severity: Severity = "medium";

    const pres = presentAlert({
      alert: a,
      customer: cust,
      expected: exp,
      latestInvoice: inv,
      latestPayment: pay,
      overdueDays,
      severity,
    });

    const sev = severityFromScore(pres.score);

    // Re-present with final severity to apply severity base (optional but keeps scoring consistent)
    const final = presentAlert({
      alert: a,
      customer: cust,
      expected: exp,
      latestInvoice: inv,
      latestPayment: pay,
      overdueDays,
      severity: sev,
    });

    return { alert: a, customer: cust, presentation: final };
  });

  // Sort by score desc
  presented.sort((x, y) => y.presentation.score - x.presentation.score);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Attention</h1>
          <p className="mt-2 text-sm text-slate-600">
            Which client accounts need attention today — and why?
          </p>
        </div>
        <Link
          href="/debug"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50"
        >
          Debug
        </Link>
      </div>

      {presented.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-slate-700">
          No attention items.
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {presented.map(({ alert, customer, presentation }) => (
            <div key={alert.id} className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {presentation.domainLabel} · {customer?.name || customer?.email || "Customer"}
                  </div>
                  <div className="mt-2 text-lg font-semibold text-slate-900">{presentation.title}</div>
                  <div className="mt-1 text-sm text-slate-700">{presentation.summary}</div>
                  <div className="mt-3 text-xs text-slate-500">{presentation.confidenceLabel}</div>
                </div>

                <div className="shrink-0">
                  <CloseAlertButton alertId={alert.id} />
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expectation</div>
                  <div className="mt-2 text-sm text-slate-800">{presentation.expectation}</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observation</div>
                  <div className="mt-2 text-sm text-slate-800">{presentation.observation}</div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Drift</div>
                  <div className="mt-2 text-sm text-slate-800">{presentation.drift}</div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next step</div>
                <div className="mt-2 text-sm text-slate-800">{presentation.nextStep}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
