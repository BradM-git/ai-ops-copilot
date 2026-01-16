// src/app/page.tsx
import { supabaseServer } from "@/lib/supabaseServer";
import { getCurrentCustomerId } from "@/lib/currentCustomer";
import AlertViewSelect from "@/components/AlertViewSelect";
import AlertRow from "@/components/AlertRow";
import {
  presentAlert,
  type AlertRow as AlertRowType,
  type CustomerRow,
  type ExpectedRevenueRow,
  type InvoiceRow,
  type PaymentRow,
  type Severity,
} from "@/lib/alertRegistry";

export const dynamic = "force-dynamic";

// Alpha scope: ONLY show Notion + QuickBooks alerts on Attention page.
const ALPHA_ALLOWED_ALERT_TYPES = new Set<string>(["notion_stale_activity", "qbo_overdue_invoice"]);

type SortKey = "urgency" | "recent";

function parseSortKey(x: unknown): SortKey {
  return x === "recent" ? "recent" : "urgency";
}

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

function toMs(iso: string) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function getOpenCta(
  alert: AlertRowType,
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

export default async function Page(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await props.searchParams) ?? {};
  const sortKey = parseSortKey(Array.isArray(sp.sort) ? sp.sort[0] : sp.sort);

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
        <div className="text-sm font-semibold text-[var(--ops-text)]">No attention items.</div>
        <div className="mt-2 text-sm text-[var(--ops-text-muted)]">Sign in to view your workspace.</div>
      </div>
    );
  }

  const { data: customersRaw } = await supabase.from("customers").select("*").eq("id", customerId);
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

  const alerts = (alertsRaw || []) as AlertRowType[];

  const openAlerts = alerts.filter((a) => {
    const src = (a.source_system || "").toLowerCase();
    return a.status === "open" && ALPHA_ALLOWED_ALERT_TYPES.has(a.type) && src !== "stripe";
  });

  let presented = openAlerts.map((a) => {
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
  });

  // Restore sort behavior (Sort by: Urgency or Recent)
  if (sortKey === "recent") {
    presented = presented.sort((x, y) => {
      const dt = toMs(y.alert.created_at) - toMs(x.alert.created_at);
      if (dt !== 0) return dt;
      return (y.presentation.score ?? 0) - (x.presentation.score ?? 0);
    });
  } else {
    presented = presented.sort((x, y) => {
      const ds = (y.presentation.score ?? 0) - (x.presentation.score ?? 0);
      if (ds !== 0) return ds;
      return toMs(y.alert.created_at) - toMs(x.alert.created_at);
    });
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-end">
        <AlertViewSelect />
      </div>

      {presented.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
          <div className="text-sm font-semibold text-[var(--ops-text)]">No attention items.</div>
          <div className="mt-2 text-sm text-[var(--ops-text-muted)]">
            If something drifts from expectation, it will appear here.
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)]">
          {presented.map(({ alert, customer, presentation, severity }, idx) => {
            const sevCls = severityRowClasses(severity);
            const sevLabel = severity === "critical" ? "Critical" : severity === "high" ? "High" : "Medium";

            const customerLabel = customer?.name || customer?.email || "Customer";
            const money = fmtMoney(alert.amount_at_risk);
            const collapsedCta = getOpenCta(alert, customer);

            return (
              <AlertRow
                key={alert.id}
                idx={idx}
                isFirstRow={idx === 0}
                railClassName={sevCls.rail}
                alertId={alert.id}
                href={collapsedCta?.href ?? null}
                openLabel={collapsedCta ? `Open in ${collapsedCta.platform}` : null}
                domainLabel={presentation.domainLabel}
                customerLabel={customerLabel}
                severityBadgeClassName={`${sevCls.badge} ${sevCls.badgeText}`}
                severityLabel={sevLabel}
                moneyLabel={money ? `${money} at risk` : null}
                title={presentation.title}
                summary={presentation.summary || null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
