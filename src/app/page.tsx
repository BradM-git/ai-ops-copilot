// src/app/page.tsx
import { supabaseServer } from "@/lib/supabaseServer";
import { getCurrentCustomerId } from "@/lib/currentCustomer";
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
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  return "medium";
}

function severityRowClasses(severity: Severity): {
  rail: string;
  badge: string;
  badgeText: string;
} {
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

function getOpenCta(
  alert: AlertRow,
  _customer: CustomerRow | null
): { platform: string; href: string } | null {
  const system = (alert.source_system || "").toLowerCase();
  if (!system) return null;

  const ctx: any = (alert as any).context;
  const urlFromContext =
    typeof ctx?.url === "string"
      ? ctx.url
      : typeof ctx?.link === "string"
      ? ctx.link
      : null;

  if (system === "notion") {
    return { platform: "Notion", href: urlFromContext || "https://www.notion.so/" };
  }
  if (system === "quickbooks") {
    return { platform: "QuickBooks", href: urlFromContext || "https://qbo.intuit.com/" };
  }
  if (system === "stripe") {
    return { platform: "Stripe", href: urlFromContext || "https://dashboard.stripe.com/" };
  }
  if (system === "jira") {
    return { platform: "Jira", href: urlFromContext || "https://www.atlassian.com/software/jira" };
  }

  return { platform: system, href: urlFromContext || "https://www.google.com" };
}

function fmtMoney(cents: number | null) {
  if (!cents) return null;
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default async function HomePage() {
  const supabase = await supabaseServer();

  let customerId: string | null = null;
  try {
    customerId = await getCurrentCustomerId();
  } catch {
    // no-op
  }

  if (!customerId) {
    return (
      <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
        <div className="text-sm font-semibold text-[var(--ops-text)]">
          No attention items.
        </div>
        <div className="mt-2 text-sm text-[var(--ops-text-muted)]">
          Sign in to view your workspace.
        </div>
      </div>
    );
  }

  const { data: customersRaw } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId);

  const customer = ((customersRaw || [])[0] || null) as CustomerRow | null;

  const { data: expectedRevenueRaw } = await supabase
    .from("expected_revenue")
    .select("*")
    .eq("customer_id", customerId);

  const expectedRevenue = (expectedRevenueRaw || []) as ExpectedRevenueRow[];
  const expected = expectedRevenue[0] || null;

  const { data: invoicesRaw } = await supabase
    .from("invoices")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  const invoices = (invoicesRaw || []) as InvoiceRow[];
  const latestInvoice = invoices[0] || null;

  const { data: paymentsRaw } = await supabase
    .from("payments")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  const payments = (paymentsRaw || []) as PaymentRow[];
  const latestPayment = payments[0] || null;

  const { data: alertsRaw } = await supabase
    .from("alerts")
    .select("*")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  const alerts = (alertsRaw || []) as AlertRow[];
  const openAlerts = alerts.filter((a) => a.status === "open");

  const presented = openAlerts
    .map((a) => {
      const pres0 = presentAlert({
        alert: a,
        customer,
        expected,
        latestInvoice,
        latestPayment,
        overdueDays: null,
        severity: "medium",
      });

      const sev = severityFromScore(pres0.score);

      const final = presentAlert({
        alert: a,
        customer,
        expected,
        latestInvoice,
        latestPayment,
        overdueDays: null,
        severity: sev,
      });

      return { alert: a, customer, presentation: final, severity: sev };
    })
    .sort((x, y) => y.presentation.score - x.presentation.score);

  return (
    <div>
      {presented.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
          <div className="text-sm font-semibold text-[var(--ops-text)]">
            No attention items.
          </div>
          <div className="mt-2 text-sm text-[var(--ops-text-muted)]">
            If something drifts from expectation, it will appear here.
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)]">
          {presented.map(({ alert, customer, presentation, severity }, idx) => {
            const sevCls = severityRowClasses(severity);
            const sevLabel =
              severity === "critical"
                ? "Critical"
                : severity === "high"
                ? "High"
                : "Medium";

            const customerLabel = customer?.name || customer?.email || "Customer";
            const cta = getOpenCta(alert, customer);
            const money = fmtMoney(alert.amount_at_risk);

            return (
              <details
                key={alert.id}
                className={`group overflow-hidden rounded-l-xl ${sevCls.rail} ${
                  idx === 0 ? "" : "border-t border-t-[var(--ops-border)]"
                }`}
              >
                <summary className="list-none cursor-pointer">
                  <div className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--ops-hover)]">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
                          {presentation.domainLabel} · {customerLabel}
                        </div>

                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${sevCls.badge} ${sevCls.badgeText}`}
                        >
                          {sevLabel}
                        </span>

                        {money ? (
                          <span className="text-xs text-[var(--ops-text-muted)]">
                            {money} at risk
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 truncate text-sm font-semibold text-[var(--ops-text)]">
                        {presentation.title}
                      </div>
                      <div className="mt-0.5 truncate text-sm text-[var(--ops-text-muted)]">
                        {presentation.summary}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {cta ? (
                        <OpenPlatformLink
                          href={cta.href}
                          label={`Open in ${cta.platform}`}
                        />
                      ) : null}
                      <CloseAlertButton alertId={alert.id} />
                    </div>
                  </div>
                </summary>

                <div className="border-t border-t-[var(--ops-border)] bg-[var(--ops-surface)] px-4 py-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
                        Expectation
                      </div>
                      <div className="mt-2 text-sm text-[var(--ops-text)]">
                        {presentation.expectation}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
                        Observation
                      </div>
                      <div className="mt-2 text-sm text-[var(--ops-text)]">
                        {presentation.observation}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
                      Drift
                    </div>
                    <div className="mt-2 text-sm text-[var(--ops-text)]">
                      {presentation.drift}
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
                      Next step
                    </div>
                    <div className="mt-2 text-sm text-[var(--ops-text)]">
                      {presentation.nextStep}
                    </div>
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
