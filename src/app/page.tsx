// src/app/page.tsx
import { supabaseServer } from "@/lib/supabaseServer";
import { getCurrentCustomerId } from "@/lib/currentCustomer";
import Alert from "@/components/Alert";
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
const ALPHA_ALLOWED_ALERT_TYPES = new Set<string>([
  "notion_stale_activity",
  "notion_stale_past_due",
  "qbo_overdue_invoice",
  "qbo_invoices_due_to_send",
]);

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

  if (system === "hubspot") {
    return { platform: "HubSpot", href: urlFromContext || "https://app.hubspot.com/" };
  }

  return { platform: system, href: urlFromContext || "https://www.google.com" };
}

function integrationLabel(alert: AlertRowType): string {
  switch ((alert.source_system || "").toLowerCase()) {
    case "quickbooks":
      return "QuickBooks";
    case "notion":
      return "Notion";
    case "hubspot":
      return "HubSpot";
    default:
      return "Integration";
  }
}

function issueSummaryFor(alert: AlertRowType): string {
  switch (alert.type) {
    case "qbo_overdue_invoice":
      return "Overdue invoices";
    case "qbo_invoices_due_to_send":
      return "Invoices due to be sent";
    case "notion_stale_activity":
      return "Possible stalled project tasks";
    case "notion_stale_past_due":
      return "Missed task deadlines";

    // Future: HubSpot types
    case "hubspot_deals_stalled":
      return "Deals stalled after activity";
    case "hubspot_late_stage_idle":
      return "Late-stage deals idle";

    default:
      return "Needs attention";
  }
}

type TriggerBlock = {
  summary: string;
  bullets: string[];
};

function HoverDefinition({
  label,
  block,
}: {
  label: string;
  block: TriggerBlock;
}) {
  return (
    <span className="relative inline-block">
      <span className="cursor-default">
        {label}
      </span>

      {/* Hover card */}
      <span
        className="pointer-events-none absolute left-0 top-full z-50 hidden w-[320px] translate-y-2 rounded-xl border border-[var(--ops-border-strong)] bg-[var(--ops-bg)] p-3 text-xs text-[var(--ops-text)] shadow-xl group-hover:block"
        aria-hidden="true"
      >
        <div className="text-[13px] font-semibold text-[var(--ops-text)]">{block.summary}</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-[var(--ops-text-muted)]">
          {block.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </span>
    </span>
  );
}

function SupportedToolsModule() {
  const defs: Record<string, TriggerBlock> = {
    qbo_overdue_invoice: {
      summary: "Overdue invoices",
      bullets: [
        "Triggers if an Invoice has Balance > 0 and DueDate < today.",
        "Shows one pattern-based alert per customer (aggregated).",
      ],
    },
    qbo_invoices_due_to_send: {
      summary: "Invoices due to be sent",
      bullets: [
        "Triggers if Invoice.TxnDate < today (invoice date has passed).",
        "AND Invoice.TotalAmt > 0 (non-zero value).",
        'AND Invoice.EmailStatus is \"NeedToSend\" or \"NotSet\" (not sent).',
        "Shows one pattern-based alert per customer (aggregated).",
      ],
    },
    notion_stale_activity: {
      summary: "Possible stalled project tasks",
      bullets: [
        "Triggers if an item is active (not complete/archived in your DB).",
        "AND now - last_edited_time ≥ NOTION_STALE_THRESHOLD_DAYS.",
      ],
    },
    notion_stale_past_due: {
      summary: "Missed task deadlines",
      bullets: [
        "Triggers if Due Date is set and Due Date ≤ (today - NOTION_PAST_DUE_GRACE_DAYS).",
        'AND Status ≠ \"Done\" (not marked complete).',
      ],
    },
    hubspot_deals_stalled: {
      summary: "Deals stalled after activity",
      bullets: [
        "Planned (paused): triggers when a deal has recent activity but no stage movement after X days.",
      ],
    },
    hubspot_late_stage_idle: {
      summary: "Late-stage deals idle",
      bullets: [
        "Planned (paused): triggers when a late-stage deal has no activity for X days.",
      ],
    },
  };

  return (
    <div className="mt-6 rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4">
      <div className="text-sm font-semibold text-[var(--ops-text)]">Supported tools & alerts</div>
      <div className="mt-1 text-sm text-[var(--ops-text-muted)]">
        Alpha scope is intentionally small. These are the only alert types we currently support.
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
            QuickBooks
          </div>
          <ul className="mt-2 space-y-1 text-sm text-[var(--ops-text-muted)]">
            <li className="group">
              • <HoverDefinition label="Overdue invoices" block={defs.qbo_overdue_invoice} />
            </li>
            <li className="group">
              • <HoverDefinition label="Invoices due to be sent" block={defs.qbo_invoices_due_to_send} />
            </li>
          </ul>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
            Notion
          </div>
          <ul className="mt-2 space-y-1 text-sm text-[var(--ops-text-muted)]">
            <li className="group">
              • <HoverDefinition label="Possible stalled project tasks" block={defs.notion_stale_activity} />
            </li>
            <li className="group">
              • <HoverDefinition label="Missed task deadlines" block={defs.notion_stale_past_due} />
            </li>
          </ul>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
            HubSpot
          </div>
          <ul className="mt-2 space-y-1 text-sm text-[var(--ops-text-muted)]">
            <li className="group">
              • <HoverDefinition label="Deals stalled after activity" block={defs.hubspot_deals_stalled} />
            </li>
            <li className="group">
              • <HoverDefinition label="Late-stage deals idle" block={defs.hubspot_late_stage_idle} />
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default async function Page() {
  const supabase = await supabaseServer();

  let customerId: string | null = null;
  try {
    customerId = await getCurrentCustomerId();
  } catch {}

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

  presented = presented.sort((x, y) => {
    const ds = (y.presentation.score ?? 0) - (x.presentation.score ?? 0);
    if (ds !== 0) return ds;
    return toMs(y.alert.created_at) - toMs(x.alert.created_at);
  });

  return (
    <div>
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
            const sevLabel =
              severity === "critical" ? "Critical" : severity === "high" ? "High" : "Medium";

            const cta = getOpenCta(alert, customer);
            const integrationName = integrationLabel(alert);
            const issueSummary = issueSummaryFor(alert);
            const issueSpecifics = (presentation.summary || presentation.title || "").trim();

            return (
              <Alert
                key={alert.id}
                alertId={alert.id}
                href={cta?.href ?? null}
                railClassName={sevCls.rail}
                isFirstRow={idx === 0}
                integrationName={integrationName}
                issueSummary={issueSummary}
                severityBadgeClassName={`${sevCls.badge} ${sevCls.badgeText}`}
                severityLabel={sevLabel}
                issueSpecifics={issueSpecifics}
              />
            );
          })}
        </div>
      )}

      <SupportedToolsModule />
    </div>
  );
}
