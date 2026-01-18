// src/app/settings/page.tsx
import { notFound } from "next/navigation";
import { getCurrentCustomerId } from "@/lib/currentCustomer";

export const dynamic = "force-dynamic";

function isSettingsEnabled() {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.DEBUG_FIXTURES_ENABLED === "true";
}

type ThresholdItem = {
  label: string;
  ruleSummary: string;
  bullets: string[];
  knobs?: { name: string; default?: string }[];
  notes?: string[];
  status?: "live" | "planned";
};

type ThresholdGroup = {
  groupLabel: string;
  items: ThresholdItem[];
};

function StatusPill({ status }: { status: "live" | "planned" }) {
  const isLive = status === "live";
  return (
    <span
      className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: isLive ? "var(--ops-sev-medium-bg)" : "var(--ops-surface)",
        color: isLive ? "var(--ops-text)" : "var(--ops-muted)",
        border: "1px solid var(--ops-border)",
      }}
    >
      {isLive ? "Live" : "Planned"}
    </span>
  );
}

function AlertThresholdsPanel() {
  const groups: ThresholdGroup[] = [
    {
      groupLabel: "QuickBooks",
      items: [
        {
          label: "Overdue invoices",
          ruleSummary: "Invoice is overdue and still has balance outstanding.",
          bullets: ["Triggers if Invoice.Balance > 0", "AND Invoice.DueDate < today"],
          notes: ["Pattern-based: one alert per customer (aggregated)."],
          status: "live",
        },
        {
          label: "Invoices due to be sent",
          ruleSummary: "Invoice date has passed but it has not been sent.",
          bullets: [
            "Triggers if Invoice.TxnDate < today (invoice date has passed)",
            "AND Invoice.TotalAmt > 0 (non-zero value)",
            'AND Invoice.EmailStatus is "NeedToSend" or "NotSet" (not sent)',
          ],
          notes: ["Pattern-based: one alert per customer (aggregated)."],
          status: "live",
        },
      ],
    },
    {
      groupLabel: "Notion",
      items: [
        {
          label: "Possible stalled project tasks",
          ruleSummary: "Active items show no edits for a threshold duration.",
          bullets: [
            "Triggers if item is active (not complete/archived in your DB)",
            "AND now - last_edited_time ≥ NOTION_STALE_THRESHOLD_DAYS",
          ],
          knobs: [{ name: "NOTION_STALE_THRESHOLD_DAYS", default: "14" }],
          status: "live",
        },
        {
          label: "Missed task deadlines",
          ruleSummary: "Tasks with a due date are overdue beyond a grace period.",
          bullets: [
            "Triggers if Due Date is set",
            "AND Due Date ≤ (today - NOTION_PAST_DUE_GRACE_DAYS)",
            'AND Status ≠ "Done" (not marked complete)',
          ],
          knobs: [{ name: "NOTION_PAST_DUE_GRACE_DAYS", default: "3" }],
          notes: ["Alpha rule: grace-days-only (no inactivity check)."],
          status: "live",
        },
      ],
    },
    {
      groupLabel: "HubSpot",
      items: [
        {
          label: "Deals stalled after activity",
          ruleSummary: "Planned: deal has activity but no stage movement after X days.",
          bullets: ["Not wired in Alpha yet."],
          status: "planned",
        },
        {
          label: "Late-stage deals idle",
          ruleSummary: "Planned: late-stage deal has no activity for X days.",
          bullets: ["Not wired in Alpha yet."],
          status: "planned",
        },
      ],
    },
  ];

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: "var(--ops-surface)",
        borderColor: "var(--ops-border)",
      }}
    >
      <div className="text-sm font-semibold" style={{ color: "var(--ops-text)" }}>
        Alert thresholds (code-defined)
      </div>
      <div className="mt-2 text-sm" style={{ color: "var(--ops-muted)" }}>
        Read-only reference for what the Alpha alerts currently use. This is not user-configurable yet.
      </div>

      <div className="mt-4 space-y-4">
        {groups.map((g) => (
          <div key={g.groupLabel}>
            <div
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--ops-text-faint)" }}
            >
              {g.groupLabel}
            </div>

            <div className="mt-2 space-y-3">
              {g.items.map((it) => (
                <div key={it.label}>
                  <div className="flex items-center">
                    <div className="text-sm font-medium" style={{ color: "var(--ops-text)" }}>
                      {it.label}
                    </div>
                    {it.status ? <StatusPill status={it.status} /> : null}
                  </div>

                  <div className="mt-1 text-sm" style={{ color: "var(--ops-muted)" }}>
                    {it.ruleSummary}
                  </div>

                  <ul
                    className="mt-2 list-disc space-y-1 pl-5 text-sm"
                    style={{ color: "var(--ops-muted)" }}
                  >
                    {it.bullets.map((b, idx) => (
                      <li key={idx}>{b}</li>
                    ))}
                  </ul>

                  {it.knobs && it.knobs.length > 0 ? (
                    <div className="mt-2 text-sm" style={{ color: "var(--ops-muted)" }}>
                      <span className="font-medium" style={{ color: "var(--ops-text)" }}>
                        Knobs:
                      </span>{" "}
                      {it.knobs
                        .map((k) => (k.default ? `${k.name} (default ${k.default})` : k.name))
                        .join(" · ")}
                    </div>
                  ) : null}

                  {it.notes && it.notes.length > 0 ? (
                    <div className="mt-2 text-sm" style={{ color: "var(--ops-muted)" }}>
                      {it.notes.join(" ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function SettingsPage() {
  if (!isSettingsEnabled()) notFound();

  let customerId: string | null = null;
  try {
    customerId = await getCurrentCustomerId();
  } catch {
    customerId = null;
  }
  if (!customerId) notFound();

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border p-4"
        style={{
          background: "var(--ops-surface)",
          borderColor: "var(--ops-border)",
        }}
      >
        <div className="text-sm font-semibold" style={{ color: "var(--ops-text)" }}>
          Alpha settings
        </div>

        <div className="mt-2 text-sm" style={{ color: "var(--ops-muted)" }}>
          There are no configurable settings in Alpha yet.
          <br />
          Current signals (Notion + QuickBooks) run on fixed rules while we validate end-to-end reliability.
        </div>
      </div>

      <AlertThresholdsPanel />

      <div
        className="rounded-xl border p-4"
        style={{
          background: "var(--ops-surface)",
          borderColor: "var(--ops-border)",
        }}
      >
        <div className="text-sm font-semibold" style={{ color: "var(--ops-text)" }}>
          Variable settings (coming soon)
        </div>
        <div className="mt-2 text-sm" style={{ color: "var(--ops-muted)" }}>
          This panel will later expose customer-specific knobs (stored in Supabase) without changing alert logic.
        </div>
      </div>
    </div>
  );
}
