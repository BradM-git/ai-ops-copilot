// src/app/page.tsx
import { supabase } from "@/lib/supabase";
import CloseAlertButton from "@/components/CloseAlertButton";
import OpenPlatformLink from "@/components/OpenPlatformLink";
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

function severityRowClasses(severity: Severity): { rail: string; badge: string; badgeText: string } {
  switch (severity) {
    case "critical":
      return {
        rail: "border-l-4 border-l-[var(--ops-sev-critical)]",
        badge: "bg-[var(--ops-sev-critical-bg)]",
        badgeText: "text-[var(--ops-sev-critical)]",
      };
    case "high":
      return {
        rail: "border-l-4 border-l-[var(--ops-sev-high)]",
        badge: "bg-[var(--ops-sev-high-bg)]",
        badgeText: "text-[var(--ops-sev-high)]",
      };
    default:
      return {
        rail: "border-l-4 border-l-[var(--ops-sev-medium)]",
        badge: "bg-[var(--ops-sev-medium-bg)]",
        badgeText: "text-[var(--ops-sev-medium)]",
      };
  }
}

function getOpenCta(alert: AlertRow, customer: CustomerRow | null): { platform: string; href: string } | null {
  const system = (alert.source_system || "").toLowerCase();

  if (system === "stripe") {
    const entityType = (alert.primary_entity_type || "").toLowerCase();
    const entityId = alert.primary_entity_id || "";
    if (entityType === "invoice" && entityId) return { platform: "Stripe", href: `https://dashboard.stripe.com/invoices/${entityId}` };
    if ((entityType === "payment_intent" || entityType === "paymentintent") && entityId)
      return { platform: "Stripe", href: `https://dashboard.stripe.com/payments/${entityId}` };
    if (customer?.stripe_customer_id) return { platform: "Stripe", href: `https://dashboard.stripe.com/customers/${customer.stripe_customer_id}` };
    return { platform: "Stripe", href: "https://dashboard.stripe.com" };
  }

  if (system === "jira") {
    const rawBase = process.env.JIRA_BASE_URL || process.env.NEXT_PUBLIC_JIRA_BASE_URL || "";
    const baseUrl = rawBase ? rawBase.replace(/\/$/, "") : "";
    if (!baseUrl) return null;

    const peType = (alert.primary_entity_type || "").toLowerCase();
    const peId = (alert.primary_entity_id || "").toLowerCase();
    if (alert.type === "integration_error" && peType === "integration" && peId === "jira") return { platform: "Jira", href: baseUrl };

    const ctx: any = (alert as any).context || {};
    const issueKey = ctx.latest_issue_key || ctx.historical_latest_issue_key || (typeof ctx.last_issue === "string" ? ctx.last_issue : null);
    if (issueKey && issueKey !== "unknown") return { platform: "Jira", href: `${baseUrl}/browse/${issueKey}` };

    const projectKey = ctx.project_key;
    if (projectKey) {
      const jql = `project = ${projectKey} ORDER BY updated DESC`;
      return { platform: "Jira", href: `${baseUrl}/issues/?jql=${encodeURIComponent(jql)}` };
    }

    return { platform: "Jira", href: baseUrl };
  }

  return null;
}

export default async function HomePage() {
  const { data: alertsRaw, error: alertsErr } = await supabase
    .from("alerts")
    .select(
      "id, customer_id, type, message, amount_at_risk, status, created_at, source_system, primary_entity_type, primary_entity_id, confidence, confidence_reason, expected_amount_cents, observed_amount_cents, expected_at, observed_at, context"
    )
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(50);

  if (alertsErr) {
    return <div className="text-sm text-[var(--ops-text-secondary)]">Failed to load alerts: {alertsErr.message}</div>;
  }

  const alerts = ((alertsRaw || []) as unknown) as AlertRow[];
  const customerIds = Array.from(new Set(alerts.map((a) => a.customer_id))).filter(Boolean);

  const { data: customersRaw } = await supabase
    .from("customers")
    .select("id, account_id, stripe_customer_id, name, email, created_at")
    .in("id", customerIds);

  const customers = ((customersRaw || []) as unknown) as CustomerRow[];
  const customersById = new Map(customers.map((c) => [c.id, c]));

  const { data: expectedRaw } = await supabase
    .from("expected_revenue")
    .select("id, customer_id, cadence_days, expected_amount, last_paid_at, confidence, created_at")
    .in("customer_id", customerIds);

  const expectedRows = ((expectedRaw || []) as unknown) as ExpectedRevenueRow[];
  const expectedByCustomer = new Map(expectedRows.map((e) => [e.customer_id, e]));

  const { data: invoicesRaw } = await supabase
    .from("invoices")
    .select("id, customer_id, stripe_invoice_id, amount_due, status, invoice_date, paid_at, created_at")
    .in("customer_id", customerIds)
    .order("invoice_date", { ascending: false });

  const invoices = ((invoicesRaw || []) as unknown) as InvoiceRow[];
  const latestInvoiceByCustomer = new Map<string, InvoiceRow>();
  for (const inv of invoices) if (!latestInvoiceByCustomer.has(inv.customer_id)) latestInvoiceByCustomer.set(inv.customer_id, inv);

  const { data: paymentsRaw } = await supabase
    .from("payments")
    .select("id, customer_id, stripe_payment_intent_id, amount, paid_at, created_at")
    .in("customer_id", customerIds)
    .order("paid_at", { ascending: false });

  const payments = ((paymentsRaw || []) as unknown) as PaymentRow[];
  const latestPaymentByCustomer = new Map<string, PaymentRow>();
  for (const p of payments) if (!latestPaymentByCustomer.has(p.customer_id)) latestPaymentByCustomer.set(p.customer_id, p);

  const presented = alerts.map((a) => {
    const cust = customersById.get(a.customer_id) || null;
    const exp = expectedByCustomer.get(a.customer_id) || null;
    const inv = latestInvoiceByCustomer.get(a.customer_id) || null;
    const pay = latestPaymentByCustomer.get(a.customer_id) || null;

    const pres = presentAlert({
      alert: a,
      customer: cust,
      expected: exp,
      latestInvoice: inv,
      latestPayment: pay,
      overdueDays: null,
      severity: "medium",
    });

    const sev = severityFromScore(pres.score);
    const final = presentAlert({
      alert: a,
      customer: cust,
      expected: exp,
      latestInvoice: inv,
      latestPayment: pay,
      overdueDays: null,
      severity: sev,
    });

    return { alert: a, customer: cust, presentation: final, severity: sev };
  });

  presented.sort((x, y) => y.presentation.score - x.presentation.score);

  return (
    <div>
      {presented.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
          <div className="text-sm font-semibold text-[var(--ops-text)]">No attention items.</div>
          <div className="mt-2 text-sm text-[var(--ops-text-muted)]">If something drifts from expectation, it will appear here.</div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)]">
          {presented.map(({ alert, customer, presentation, severity }, idx) => {
            const sevCls = severityRowClasses(severity);
            const sevLabel = severity === "critical" ? "Critical" : severity === "high" ? "High" : "Medium";
            const customerLabel = customer?.name || customer?.email || "Customer";
            const cta = getOpenCta(alert, customer);

            return (
              <details
                key={alert.id}
                className={`group overflow-hidden rounded-l-xl ${sevCls.rail} ${idx === 0 ? "" : "border-t border-t-[var(--ops-border)]"}`}
              >
                <summary className="list-none cursor-pointer">
                  <div className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--ops-hover)]">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
                          {presentation.domainLabel} · {customerLabel}
                        </div>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${sevCls.badge} ${sevCls.badgeText}`}>
                          {sevLabel}
                        </span>
                      </div>

                      <div className="mt-1 truncate text-sm font-semibold text-[var(--ops-text)]">{presentation.title}</div>
                      <div className="mt-0.5 truncate text-sm text-[var(--ops-text-secondary)]">{presentation.summary}</div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {cta ? <OpenPlatformLink href={cta.href} label={`Open in ${cta.platform}`} /> : null}
                      <CloseAlertButton alertId={alert.id} />
                    </div>
                  </div>
                </summary>

                <div className="px-4 pb-4 pt-2">
                  <div className="text-xs text-[var(--ops-text-faint)]">{presentation.confidenceLabel}</div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">Expectation</div>
                      <div className="mt-2 text-sm text-[var(--ops-text)]">{presentation.expectation}</div>
                    </div>

                    <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">Observation</div>
                      <div className="mt-2 text-sm text-[var(--ops-text)]">{presentation.observation}</div>
                    </div>

                    <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">Drift</div>
                      <div className="mt-2 text-sm text-[var(--ops-text)]">{presentation.drift}</div>
                    </div>
                  </div>

                  <div className="mt-2 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">Next step</div>
                    <div className="mt-2 text-sm text-[var(--ops-text)]">{presentation.nextStep}</div>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}
