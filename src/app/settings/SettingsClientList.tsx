"use client";

import * as React from "react";

type Customer = {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
};

type CustomerSettings = {
  customer_id: string;
  missed_payment_grace_days: number;
  missed_payment_low_conf_cutoff: number;
  missed_payment_low_conf_min_risk_cents: number;
  amount_drift_threshold_pct: number;
  jira_activity_lookback: string;
  updated_at: string;
};

export function SettingsClientList({
  customers,
  settings,
  defaultOpenCustomerId,
}: {
  customers: Customer[];
  settings: CustomerSettings[];
  defaultOpenCustomerId?: string | null;
  upsertCustomerSettings: (formData: FormData) => Promise<void>; // kept for signature compatibility (unused in alpha UI)
}) {
  const settingsByCustomer = React.useMemo(() => {
    const m = new Map<string, CustomerSettings>();
    for (const s of settings || []) m.set(s.customer_id, s);
    return m;
  }, [settings]);

  const [openId, setOpenId] = React.useState<string | null>(
    defaultOpenCustomerId ?? customers?.[0]?.id ?? null
  );

  return (
    <div className="space-y-2">
      {customers.map((c) => {
        const isOpen = openId === c.id;
        const label = c.name || c.email || c.id;

        const existing = settingsByCustomer.get(c.id);

        return (
          <div
            key={c.id}
            className="rounded-xl border overflow-hidden"
            style={{
              background: "var(--ops-surface)",
              borderColor: "var(--ops-border)",
            }}
          >
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : c.id)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="min-w-0">
                <div className="font-medium truncate" style={{ color: "var(--ops-text)" }}>
                  {label}
                </div>
                {c.email ? (
                  <div className="text-sm truncate" style={{ color: "var(--ops-muted)" }}>
                    {c.email}
                  </div>
                ) : null}
              </div>

              <div className="ml-3 shrink-0 text-sm" style={{ color: "var(--ops-muted)" }}>
                {isOpen ? "−" : "+"}
              </div>
            </button>

            {isOpen ? (
              <div className="px-4 pb-4">
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
                    Current signals (Notion stale + QuickBooks overdue) run on fixed rules while we
                    validate end-to-end reliability.
                  </div>

                  <div className="mt-4 text-xs" style={{ color: "var(--ops-muted)" }}>
                    Last updated:{" "}
                    {existing?.updated_at ? new Date(existing.updated_at).toLocaleString() : "—"}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
