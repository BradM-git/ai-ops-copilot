// src/app/page.tsx
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import CloseAlertButton from "@/components/CloseAlertButton";
import { presentAlert, type AlertRow, type CustomerRow, type ExpectedRevenueRow, type InvoiceRow, type PaymentRow, type Severity } from "@/lib/alertRegistry";

export const dynamic = "force-dynamic";

function daysBetween(fromISO: string, toISO: string) {
  const from = new Date(fromISO).getTime();
  const to = new Date(toISO).getTime();
  return Math.floor((to - from) / (1000 * 60 * 60 * 24));
}

function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function severityFor(amountAtRiskCents: number, overdueDays: number | null): Severity {
  const amt = amountAtRiskCents;
  const overdue = overdueDays ?? 0;
  if (amt >= 500000 || overdue >= 14) return "critical";
  if (amt >= 150000 || overdue >= 7) return "high";
  return "medium";
}

function badgeClass(s: Severity) {
  if (s === "critical") return "bg-red-600 text-white";
  if (s === "high") return "bg-amber-500 text-white";
  return "bg-slate-700 text-white";
}

function stripeCustomerUrl(customer: CustomerRow | null): string | null {
  const id = customer?.stripe_customer_id;
  if (!id) return null;
  return `https://dashboard.stripe.com/customers/${id}`;
}

type AttentionItem = {
  alert: AlertRow;
  customer: CustomerRow | null;
  expected: ExpectedRevenueRow | null;
  latestInvoice: InvoiceRow | null;
  latestPayment: PaymentRow | null;

  overdueDays: number | null;
  severity: Severity;

  // from registry
  domainLabel: string;
  title: string;
  summary: string;
  expectation: string;
  observation: string;
  drift: string;
  nextStep: string;
  confidenceLabel: string;
  score: number;

  stripeUrl: string | null;
};

export default async function HomePage() {
  const { data: alertsRaw, error } = await supabase
    .from("alerts")
    .select(
      [
        "id",
        "customer_id",
        "type",
        "message",
        "amount_at_risk",
        "status",
        "created_at",
        "source_system",
        "primary_entity_type",
        "primary_entity_id",
        "confidence",
        "confidence_reason",
        "expected_amount_cents",
        "observed_amount_cents",
        "expected_at",
        "observed_at",
        "context",
      ].join(",")
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);

  const alerts = (alertsRaw || []) as AlertRow[];

  const customerIds = Array.from(new Set(alerts.map((a) => a.customer_id))).filter(Boolean);

  const [{ data: customersRaw }, { data: expectedRaw }, { data: invoicesRaw }, { data: paymentsRaw }] = await Promise.all([
    supabase.from("customers").select("id, account_id, stripe_customer_id, name, email, created_at").in("id", customerIds),
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

  const latestInvoiceByCustomerId = new Map<string, InvoiceRow>();
  for (const inv of invoices) {
    if (!latestInvoiceByCustomerId.has(inv.customer_id)) latestInvoiceByCustomerId.set(inv.customer_id, inv);
  }

  const latestPaymentByCustomerId = new Map<string, PaymentRow>();
  for (const p of payments) {
    if (!latestPaymentByCustomerId.has(p.customer_id)) latestPaymentByCustomerId.set(p.customer_id, p);
  }

  const nowIso = new Date().toISOString();

  const items: AttentionItem[] = alerts.map((a) => {
    const cust = customerById.get(a.customer_id) || null;
    const exp = expectedByCustomerId.get(a.customer_id) || null;
    const inv = latestInvoiceByCustomerId.get(a.customer_id) || null;
    const pay = latestPaymentByCustomerId.get(a.customer_id) || null;

    // overdueDays is only meaningful for cadence-based alert types, but safe to compute generically.
    let overdueDays: number | null = null;
    if (a.expected_at) {
      overdueDays = daysBetween(a.expected_at, nowIso);
      if (overdueDays < 0) overdueDays = 0;
    } else {
      const cadence = exp?.cadence_days ?? null;
      const lastPaid = exp?.last_paid_at ?? pay?.paid_at ?? null;
      if (cadence && lastPaid) {
        const expectedBy = addDays(lastPaid, cadence);
        overdueDays = daysBetween(expectedBy, nowIso);
        if (overdueDays < 0) overdueDays = 0;
      }
    }

    const amountAtRisk = Number(a.amount_at_risk ?? 0);
    const severity = severityFor(amountAtRisk, overdueDays);

    const pres = presentAlert({
      alert: a,
      customer: cust,
      expected: exp,
      latestInvoice: inv,
      latestPayment: pay,
      overdueDays,
      severity,
    });

    return {
      alert: a,
      customer: cust,
      expected: exp,
      latestInvoice: inv,
      latestPayment: pay,

      overdueDays,
      severity,

      domainLabel: pres.domainLabel,
      title: pres.title,
      summary: pres.summary,
      expectation: pres.expectation,
      observation: pres.observation,
      drift: pres.drift,
      nextStep: pres.nextStep,
      confidenceLabel: pres.confidenceLabel,
      score: pres.score,

      stripeUrl: stripeCustomerUrl(cust),
    };
  });

  items.sort((x, y) => {
    const d = y.score - x.score;
    if (d !== 0) return d;
    return new Date(y.alert.created_at).getTime() - new Date(x.alert.created_at).getTime();
  });

  const counts = items.reduce(
    (acc, it) => {
      acc[it.severity] += 1;
      return acc;
    },
    { critical: 0, high: 0, medium: 0 } as Record<Severity, number>
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Today’s Attention</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Only issues that require your attention appear here. When everything is operating as expected, this view stays empty.
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-2">
          {counts.critical > 0 && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass("critical")}`}>Critical · {counts.critical}</span>
          )}
          {counts.high > 0 && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass("high")}`}>High · {counts.high}</span>
          )}
          {counts.medium > 0 && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass("medium")}`}>Medium · {counts.medium}</span>
          )}
        </div>
      </header>

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">What needs attention</h2>
                  <p className="mt-1 text-xs text-slate-600">Ordered by urgency.</p>
                </div>
              </div>
            </div>

            {error ? (
              <div className="px-5 py-6 text-sm text-red-700">Failed to load attention items: {String((error as any).message || error)}</div>
            ) : items.length === 0 ? (
              <div className="px-5 py-10">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold">
                    ✓
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Nothing needs your attention right now.</div>
                    <div className="mt-1 text-sm text-slate-600">
                      Based on the systems currently connected, no deviations from expectation require intervention.
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
                            <div className={`mt-0.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass(it.severity)}`}>
                              {it.severity.toUpperCase()}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-slate-900">{it.title}</div>
                                  <div className="mt-1 text-sm text-slate-600">{it.summary}</div>
                                </div>

                                <div className="hidden sm:block text-right text-xs text-slate-500">
                                  <div>{it.confidenceLabel}</div>
                                  <div className="mt-1">{new Date(a.created_at).toLocaleString()}</div>
                                </div>
                              </div>

                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                                <span className="rounded-full bg-slate-100 px-2 py-1">{it.domainLabel}</span>
                                {a.source_system ? <span className="rounded-full bg-slate-100 px-2 py-1">{a.source_system}</span> : null}
                                <span className="rounded-full bg-slate-100 px-2 py-1">{customerLabel}</span>
                                {it.overdueDays != null ? (
                                  <span className="rounded-full bg-slate-100 px-2 py-1">{it.overdueDays}d overdue</span>
                                ) : null}
                                <span className="ml-auto text-slate-400 group-open:hidden">Click to view details</span>
                              </div>
                            </div>
                          </div>
                        </summary>

                        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                            <div className="sm:col-span-1">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Expected behavior</div>
                              <div className="mt-2 text-sm text-slate-900">{it.expectation}</div>
                            </div>

                            <div className="sm:col-span-1">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">What’s happening</div>
                              <div className="mt-2 text-sm text-slate-900">{it.observation}</div>
                            </div>

                            <div className="sm:col-span-1">
                              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why this matters</div>
                              <div className="mt-2 text-sm text-slate-900">{it.drift}</div>
                            </div>
                          </div>

                          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommended next step</div>
                            <div className="mt-2 text-sm text-slate-900">{it.nextStep}</div>
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

                            <CloseAlertButton alertId={a.id} />
                          </div>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-6 text-sm text-slate-600">
            Want to inspect generators and toggle real upstream drift?{" "}
            <Link href="/debug" className="underline">
              Open Debug
            </Link>
            .
          </div>
        </div>

        <aside className="lg:col-span-1">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
            <div className="text-sm font-semibold text-slate-900">What this is</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              AI Ops Copilot surfaces only deviations from expectation that warrant intervention. Healthy systems stay invisible.
            </p>

            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current coverage</div>
              <ul className="mt-2 space-y-2 text-sm text-slate-700">
                <li>• Missed expected payment</li>
                <li>• Payment amount drift</li>
              </ul>
              <div className="mt-3 text-xs text-slate-500">Revenue integrity wedge. More domains later.</div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
