// src/app/page.tsx
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import CloseAlertButton from "@/components/CloseAlertButton";

export const dynamic = "force-dynamic";

type Severity = "critical" | "high" | "medium";

type AlertRow = {
  id: string;
  customer_id: string;
  type: string;
  message: string | null;
  amount_at_risk: number | null;
  status: string;
  created_at: string;
};

type CustomerRow = {
  id: string;
  account_id: string;
  stripe_customer_id: string | null;
  name: string | null;
  email: string | null;
  created_at: string;
};

type ExpectedRevenueRow = {
  id: string;
  customer_id: string;
  cadence_days: number | null;
  expected_amount: number | null;
  last_paid_at: string | null;
  confidence: number | null; // float in your schema
  created_at: string;
};

type InvoiceRow = {
  id: string;
  customer_id: string;
  stripe_invoice_id: string | null;
  amount_due: number | null;
  status: string | null;
  invoice_date: string | null;
  paid_at: string | null;
  created_at: string;
};

type PaymentRow = {
  id: string;
  customer_id: string;
  stripe_payment_intent_id: string | null;
  amount: number | null;
  paid_at: string | null;
  created_at: string;
};

type AttentionItem = {
  alert: AlertRow;
  customer: CustomerRow | null;
  expected: ExpectedRevenueRow | null;
  latestInvoice: InvoiceRow | null;
  latestPayment: PaymentRow | null;
  sev: Severity;
  overdueDays: number | null;
  expectation: string;
  observation: string;
  drift: string;
  confidenceLabel: string;
  title: string;
  summary: string;
  stripeUrl: string | null;
};

function fmtMoneyCents(n: number) {
  // your schema uses int8 for amounts. assuming cents.
  return (n / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function daysBetween(fromISO: string, toISO: string) {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  const ms = to - from;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function formatDateShort(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function severityFor(amountAtRiskCents: number, overdueDays: number | null): Severity {
  const amt = amountAtRiskCents;
  const overdue = overdueDays ?? 0;

  // Opinionated defaults (adjust later with real world data)
  if (amt >= 500000 || overdue >= 14) return "critical"; // $5,000+
  if (amt >= 150000 || overdue >= 7) return "high";      // $1,500+
  return "medium";
}

function severityRank(s: Severity) {
  return s === "critical" ? 0 : s === "high" ? 1 : 2;
}

function badgeClass(s: Severity) {
  if (s === "critical") return "bg-red-600 text-white";
  if (s === "high") return "bg-amber-500 text-white";
  return "bg-slate-700 text-white";
}

function confidenceLabelFromFloat(conf: number | null): string {
  if (conf == null) return "Confidence not set";
  if (conf >= 0.8) return "High confidence";
  if (conf >= 0.5) return "Medium confidence";
  return "Low confidence";
}

function stripeCustomerUrl(customer: CustomerRow | null): string | null {
  const id = customer?.stripe_customer_id;
  if (!id) return null;
  return `https://dashboard.stripe.com/customers/${id}`;
}

function buildCopy(params: {
  customer: CustomerRow | null;
  expected: ExpectedRevenueRow | null;
  latestInvoice: InvoiceRow | null;
  latestPayment: PaymentRow | null;
  amountAtRisk: number;
  overdueDays: number | null;
  alertMessage: string | null;
}): Pick<AttentionItem, "title" | "summary" | "expectation" | "observation" | "drift"> {
  const name = params.customer?.name || params.customer?.email || "Customer";

  // Expectation: derived from cadence + last paid
  const cadence = params.expected?.cadence_days ?? null;
  const lastPaid = params.expected?.last_paid_at ?? params.latestPayment?.paid_at ?? null;
  const expectedAmt = params.expected?.expected_amount ?? null;

  let expectation = "Expected outcome not specified.";
  if (cadence && lastPaid) {
    const expectedBy = addDays(lastPaid, cadence);
    expectation = `${name} typically pays every ${cadence} days. Next payment expected by ${formatDateShort(expectedBy)}.`;
  } else if (cadence) {
    expectation = `${name} is expected to pay on a ~${cadence}-day cadence.`;
  } else {
    expectation = `${name} is expected to pay on a regular cadence (not yet inferred).`;
  }

  // Observation: based on latest invoice/payment
  const inv = params.latestInvoice;
  const pay = params.latestPayment;

  const invPart =
    inv?.stripe_invoice_id
      ? `Latest invoice ${inv.status || "—"} (${formatDateShort(inv.invoice_date)}), ${inv.paid_at ? "paid" : "unpaid"}.`
      : "No invoice context available.";

  const payPart =
    pay?.paid_at ? `Last payment received ${formatDateShort(pay.paid_at)}.` : "No recent payment recorded.";

  const observation = `${payPart} ${invPart}`;

  // Drift: overdue + amount at risk
  const overdueText =
    params.overdueDays != null && params.overdueDays > 0
      ? `Overdue by ${params.overdueDays} days.`
      : `Deviation detected.`;

  const amtText = params.amountAtRisk ? `${fmtMoneyCents(params.amountAtRisk)} at risk.` : "Amount at risk unknown.";

  const drift = `${overdueText} ${amtText}`;

  // Title + summary (tight)
  const title = "Payment expected but not received";
  const summaryParts = [
    params.amountAtRisk ? `${fmtMoneyCents(params.amountAtRisk)} expected` : null,
    params.overdueDays != null ? `${params.overdueDays} days overdue` : null,
  ].filter(Boolean);

  const summary =
    summaryParts.length > 0 ? summaryParts.join(" · ") : (params.alertMessage || "Deviation from expectation detected.");

  return { title, summary, expectation, observation, drift };
}

export default async function HomePage() {
  // 1) Fetch open alerts (schema-correct)
  const { data: alertsRaw, error } = await supabase
    .from("alerts")
    .select("id, customer_id, type, message, amount_at_risk, status, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);

  const alerts = (alertsRaw || []) as AlertRow[];

  // 2) Batch fetch related entities (customers + expected_revenue + invoices + payments)
  const customerIds = Array.from(new Set(alerts.map((a) => a.customer_id))).filter(Boolean);

  const [{ data: customersRaw }, { data: expectedRaw }, { data: invoicesRaw }, { data: paymentsRaw }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, account_id, stripe_customer_id, name, email, created_at")
        .in("id", customerIds),
      supabase
        .from("expected_revenue")
        .select("id, customer_id, cadence_days, expected_amount, last_paid_at, confidence, created_at")
        .in("customer_id", customerIds),
      supabase
        .from("invoices")
        .select("id, customer_id, stripe_invoice_id, amount_due, status, invoice_date, paid_at, created_at")
        .in("customer_id", customerIds)
        .order("invoice_date", { ascending: false }),
      supabase
        .from("payments")
        .select("id, customer_id, stripe_payment_intent_id, amount, paid_at, created_at")
        .in("customer_id", customerIds)
        .order("paid_at", { ascending: false }),
    ]);

  const customers = (customersRaw || []) as CustomerRow[];
  const expected = (expectedRaw || []) as ExpectedRevenueRow[];
  const invoices = (invoicesRaw || []) as InvoiceRow[];
  const payments = (paymentsRaw || []) as PaymentRow[];

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const expectedByCustomerId = new Map(expected.map((e) => [e.customer_id, e]));

  // latest invoice/payment per customer
  const latestInvoiceByCustomerId = new Map<string, InvoiceRow>();
  for (const inv of invoices) {
    if (!latestInvoiceByCustomerId.has(inv.customer_id)) latestInvoiceByCustomerId.set(inv.customer_id, inv);
  }

  const latestPaymentByCustomerId = new Map<string, PaymentRow>();
  for (const p of payments) {
    if (!latestPaymentByCustomerId.has(p.customer_id)) latestPaymentByCustomerId.set(p.customer_id, p);
  }

  // 3) Build attention items with derived expectation/observation/drift
  const nowIso = new Date().toISOString();

  const items: AttentionItem[] = alerts.map((a) => {
    const cust = customerById.get(a.customer_id) || null;
    const exp = expectedByCustomerId.get(a.customer_id) || null;
    const inv = latestInvoiceByCustomerId.get(a.customer_id) || null;
    const pay = latestPaymentByCustomerId.get(a.customer_id) || null;

    // derive overdue: last_paid_at + cadence vs now
    const cadence = exp?.cadence_days ?? null;
    const lastPaid = exp?.last_paid_at ?? pay?.paid_at ?? null;

    let overdueDays: number | null = null;
    if (cadence && lastPaid) {
      const expectedBy = addDays(lastPaid, cadence);
      overdueDays = daysBetween(expectedBy, nowIso);
      if (overdueDays < 0) overdueDays = 0;
    }

    const amountAtRisk = Number(a.amount_at_risk ?? 0);

    const sev = severityFor(amountAtRisk, overdueDays);

    const confidenceLabel = confidenceLabelFromFloat(exp?.confidence ?? null);

    const copy = buildCopy({
      customer: cust,
      expected: exp,
      latestInvoice: inv,
      latestPayment: pay,
      amountAtRisk,
      overdueDays,
      alertMessage: a.message,
    });

    return {
      alert: a,
      customer: cust,
      expected: exp,
      latestInvoice: inv,
      latestPayment: pay,
      sev,
      overdueDays,
      confidenceLabel,
      stripeUrl: stripeCustomerUrl(cust),
      ...copy,
    };
  });

  // 4) Sort (severity → revenue-first placeholder → recency)
  items.sort((x, y) => {
    const d = severityRank(x.sev) - severityRank(y.sev);
    if (d !== 0) return d;
    return new Date(y.alert.created_at).getTime() - new Date(x.alert.created_at).getTime();
  });

  const counts = items.reduce(
    (acc, it) => {
      acc[it.sev] += 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0 } as Record<Severity, number>
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Today’s Attention
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Only issues that require your attention appear here. When everything is operating as expected, this view stays empty.
          </p>

        </div>

        <div className="hidden sm:flex items-center gap-2">
          {counts.critical > 0 && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass("critical")}`}>
              Critical · {counts.critical}
            </span>
          )}
          {counts.high > 0 && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass("high")}`}>
              High · {counts.high}
            </span>
          )}
          {counts.medium > 0 && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass("medium")}`}>
              Medium · {counts.medium}
            </span>
          )}
        </div>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main attention feed */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">What needs attention</h2>
                  <p className="mt-1 text-xs text-slate-600">
                  Ordered by urgency.
                  </p>
                </div>
              </div>
            </div>

            {error ? (
              <div className="px-5 py-6 text-sm text-red-700">
                Failed to load attention items: {String(error.message || error)}
              </div>
            ) : items.length === 0 ? (
              <div className="px-5 py-10">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold">
                    ✓
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                    Nothing needs your attention right now.
                    </div>
                    <div className="mt-1 text-sm text-slate-600">
                      Based on the systems currently connected, no deviations from expectation require intervention. As coverage expands, this signal becomes more complete.
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-slate-200">
                {items.map((it) => {
                  const a = it.alert;
                  const customerLabel = it.customer?.name || it.customer?.email || "Customer";

                  return (
                    <li key={a.id} className="px-5 py-4">
                      <details className="group">
                        <summary className="list-none cursor-pointer select-none">
                          <div className="flex items-start gap-3">
                            <div className={`mt-0.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass(it.sev)}`}>
                              {it.sev.toUpperCase()}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-900">
                                    {it.title}
                                  </div>
                                  <div className="mt-1 text-sm text-slate-600">
                                    {it.summary}
                                  </div>
                                </div>

                                <div className="hidden sm:block text-right text-xs text-slate-500">
                                  <div>{it.confidenceLabel}</div>
                                  <div className="mt-1">
                                    {new Date(a.created_at).toLocaleString()}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                <span className="rounded-full bg-slate-100 px-2 py-1">
                                  Revenue
                                </span>
                                <span className="rounded-full bg-slate-100 px-2 py-1">
                                  Stripe
                                </span>
                                <span className="rounded-full bg-slate-100 px-2 py-1">
                                  {customerLabel}
                                </span>
                                {it.overdueDays != null ? (
                                  <span className="rounded-full bg-slate-100 px-2 py-1">
                                    {it.overdueDays}d overdue
                                  </span>
                                ) : null}
                                <span className="ml-auto text-slate-400 group-open:hidden">
                                  Click to view details
                                </span>
                              </div>
                            </div>
                          </div>
                        </summary>

                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <div className="sm:col-span-1">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Expected behavior
                              </div>
                              <div className="mt-2 text-sm text-slate-900">
                                {it.expectation}
                              </div>
                            </div>

                            <div className="sm:col-span-1">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                What’s happening
                              </div>
                              <div className="mt-2 text-sm text-slate-900">
                                {it.observation}
                              </div>
                            </div>

                            <div className="sm:col-span-1">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Why this matters
                              </div>
                              <div className="mt-2 text-sm text-slate-900">
                                {it.drift}
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-3">
                            {it.stripeUrl ? (
                              <a
                                href={it.stripeUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                              >
                                View in Stripe
                              </a>
                            ) : (
                              <button
                                disabled
                                className="inline-flex items-center justify-center rounded-xl bg-slate-300 px-4 py-2 text-sm font-semibold text-white cursor-not-allowed"
                                title="No Stripe customer id available for deep link."
                              >
                                View in Stripe
                              </button>
                            )}

                            {/* Escape hatch (not primary) */}
                            <CloseAlertButton alertId={a.id} />

                            <span className="text-xs text-slate-500">
                              Auto-resolves when observation matches expectation again.
                            </span>
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Structural placeholders for future domains */}
        <aside className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Domains</h3>
            <p className="mt-1 text-xs text-slate-600">
              Structural placeholders only. No fake signals.
            </p>

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">Revenue</div>
                <div className="mt-1 text-xs text-slate-600">
                  Active signal: expected vs received.
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">Delivery</div>
                <div className="mt-1 text-xs text-slate-600">Not enabled.</div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">Clients</div>
                <div className="mt-1 text-xs text-slate-600">Not enabled.</div>
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-500">
              This system stays quiet when things are operating as expected.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-900">Notes</h3>
            <p className="mt-2 text-xs text-slate-600">
              Alerts are treated as inputs. This view is the primary product surface.
              Deep links route you to the source of truth.
            </p>
            <div className="mt-3 text-xs text-slate-500">
              <Link href="/alerts" className="underline">
                (Optional) Raw alerts view
              </Link>
              {" "}— only if you already have it.
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
