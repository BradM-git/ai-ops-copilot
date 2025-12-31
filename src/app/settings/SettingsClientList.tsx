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

function Field({
  label,
  name,
  defaultValue,
  hint,
  type = "text",
  step,
}: {
  label: string;
  name: string;
  defaultValue: string | number;
  hint?: string;
  type?: "text" | "number";
  step?: string;
}) {
  return (
    <label className="block">
      <div className="text-sm font-medium" style={{ color: "var(--ops-text)" }}>
        {label}
      </div>
      {hint ? (
        <div className="text-xs mt-0.5" style={{ color: "var(--ops-muted)" }}>
          {hint}
        </div>
      ) : null}

      <input
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{
          background: "var(--ops-surface)",
          borderColor: "var(--ops-border)",
          color: "var(--ops-text)",
        }}
      />
    </label>
  );
}

export function SettingsClientList({
  customers,
  settings,
  defaultOpenCustomerId,
  upsertCustomerSettings,
}: {
  customers: Customer[];
  settings: CustomerSettings[];
  defaultOpenCustomerId?: string | null;
  upsertCustomerSettings: (formData: FormData) => Promise<void>;
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

        const defaults: CustomerSettings = existing ?? {
          customer_id: c.id,
          missed_payment_grace_days: 3,
          missed_payment_low_conf_cutoff: 0.6,
          missed_payment_low_conf_min_risk_cents: 50_00,
          amount_drift_threshold_pct: 20,
          jira_activity_lookback: "P7D",
          updated_at: new Date().toISOString(),
        };

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
                <div
                  className="font-medium truncate"
                  style={{ color: "var(--ops-text)" }}
                >
                  {label}
                </div>
                {c.email ? (
                  <div
                    className="text-sm truncate"
                    style={{ color: "var(--ops-muted)" }}
                  >
                    {c.email}
                  </div>
                ) : null}
              </div>

              <div
                className="ml-3 shrink-0 text-sm"
                style={{ color: "var(--ops-muted)" }}
              >
                {isOpen ? "−" : "+"}
              </div>
            </button>

            {isOpen ? (
              <div className="px-4 pb-4">
                <form action={upsertCustomerSettings} className="space-y-4">
                  <input type="hidden" name="customer_id" value={c.id} />

                  <div
                    className="rounded-xl border p-4"
                    style={{
                      background: "var(--ops-surface)",
                      borderColor: "var(--ops-border)",
                    }}
                  >
                    <div
                      className="text-sm font-semibold"
                      style={{ color: "var(--ops-text)" }}
                    >
                      Risk thresholds
                    </div>

                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Field
                        label="Missed payment grace days"
                        name="missed_payment_grace_days"
                        type="number"
                        step="1"
                        defaultValue={defaults.missed_payment_grace_days}
                        hint="How many days after due date before flagging missed payment."
                      />

                      <Field
                        label="Low confidence cutoff"
                        name="missed_payment_low_conf_cutoff"
                        type="number"
                        step="0.01"
                        defaultValue={defaults.missed_payment_low_conf_cutoff}
                        hint="Model confidence below this is treated as low-confidence."
                      />

                      <Field
                        label="Low confidence min risk (cents)"
                        name="missed_payment_low_conf_min_risk_cents"
                        type="number"
                        step="1"
                        defaultValue={defaults.missed_payment_low_conf_min_risk_cents}
                        hint="If low-confidence, only show if risk >= this."
                      />

                      <Field
                        label="Amount drift threshold (%)"
                        name="amount_drift_threshold_pct"
                        type="number"
                        step="1"
                        defaultValue={defaults.amount_drift_threshold_pct}
                        hint="Flag if payment/invoice amount deviates beyond this percent."
                      />

                      <Field
                        label="Jira activity lookback"
                        name="jira_activity_lookback"
                        defaultValue={defaults.jira_activity_lookback}
                        hint="ISO-8601 duration (e.g. P7D). Keep as-is during Alpha."
                      />
                    </div>

                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-xs" style={{ color: "var(--ops-muted)" }}>
                        Last updated:{" "}
                        {defaults.updated_at
                          ? new Date(defaults.updated_at).toLocaleString()
                          : "—"}
                      </div>

                      <button type="submit" className="ops-cta">
                        Save
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
