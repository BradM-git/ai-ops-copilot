// src/app/debug/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type DebugKey =
  | "stripe.missed_expected_payment"
  | "stripe.payment_amount_drift"
  | "jira.no_recent_client_activity";

type DebugRow = {
  key: DebugKey;
  label: string;
  type: string;
  source: string;
};

type AlertRow = {
  id: string;
  customer_id: string;
  type: string;
  status: string;
  amount_at_risk: number | null;
  source_system: string | null;
  created_at: string;
};

const SUPPORTED: DebugRow[] = [
  {
    key: "stripe.missed_expected_payment",
    label: "Missed expected payment",
    type: "missed_expected_payment",
    source: "stripe",
  },
  {
    key: "stripe.payment_amount_drift",
    label: "Payment amount drift",
    type: "payment_amount_drift",
    source: "stripe",
  },
  {
    key: "jira.no_recent_client_activity",
    label: "No recent client activity",
    type: "no_recent_client_activity",
    source: "jira",
  },
];

export default function DebugPage() {
  const [enabled, setEnabled] = useState(true);
  const [customerId, setCustomerId] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string>("");

  async function refresh() {
    const res = await fetch("/api/debug/alerts/list", { method: "GET" });
    if (!res.ok) {
      setEnabled(false);
      return;
    }
    const data = await res.json();
    setEnabled(true);
    setCustomerId(data.customerId || null);
    setAlerts(data.alerts || []);
    setToggles(data.toggles || {});
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    return SUPPORTED.map((spec) => {
      const existing = alerts.find(
        (a) => a.type === spec.type && a.source_system === spec.source
      );
      const isOpen = Boolean(toggles[spec.key]);
      return { spec, existing, isOpen };
    });
  }, [alerts, toggles]);

  async function toggleKey(key: DebugKey, enabledToggle: boolean) {
    setBusy((b) => ({ ...b, [key]: true }));
    setMsg("");

    try {
      if (!customerId) throw new Error("No customer");

      const res = await fetch("/api/debug/toggles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled: enabledToggle }),
      });

      if (!res.ok) throw new Error("Toggle failed");

      const data = await res.json();
      setToggles((t) => ({ ...t, [key]: enabledToggle }));
      setAlerts(data.alerts || []);
      setMsg("Updated.");
    } catch (e: any) {
      setMsg(e?.message || "Toggle failed");
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  }

  if (!enabled) {
    return (
      <main className="px-0">
        <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
          <div className="text-sm text-[var(--ops-text-secondary)]">
            Not found.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="px-0">
      {msg ? (
        <div className="mb-4 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] px-4 py-3 text-sm text-[var(--ops-text)]">
          {msg}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)]">
        <div className="grid grid-cols-12 border-b border-[var(--ops-border)] bg-[var(--ops-surface)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
          <div className="col-span-4">Alert</div>
          <div className="col-span-3">Type</div>
          <div className="col-span-2">Source</div>
          <div className="col-span-1">State</div>
          <div className="col-span-2 text-right">Toggle</div>
        </div>

        {rows.map(({ spec, existing, isOpen }) => {
          const isBusy = Boolean(busy[spec.key]);
          const label = isOpen ? "ON" : "OFF";

          return (
            <div
              key={spec.key}
              className="grid grid-cols-12 items-center border-b border-[var(--ops-border)]/60 px-4 py-4 last:border-b-0"
            >
              <div className="col-span-4">
                <div className="text-sm font-semibold text-[var(--ops-text)]">
                  {spec.label}
                </div>
                <div className="mt-1 text-xs text-[var(--ops-text-faint)]">
                  customer {customerId ? `${customerId.slice(0, 8)}…` : "—"}
                </div>
              </div>

              <div className="col-span-3">
                <div className="text-sm text-[var(--ops-text)]">{spec.type}</div>
                <div className="mt-1 text-xs text-[var(--ops-text-faint)]">
                  {existing?.amount_at_risk != null
                    ? `amount_at_risk=${existing.amount_at_risk}`
                    : "amount_at_risk=—"}
                </div>
              </div>

              <div className="col-span-2">
                <div className="text-sm text-[var(--ops-text)]">{spec.source}</div>
                <div className="mt-1 text-xs text-[var(--ops-text-faint)]">
                  {existing?.status ? existing.status : "—"}
                </div>
              </div>

              <div className="col-span-1">
                <div className="text-sm text-[var(--ops-text)]">{label}</div>
              </div>

              <div className="col-span-2 flex justify-end">
                <button
                  type="button"
                  disabled={isBusy || !customerId}
                  onClick={() => toggleKey(spec.key, !isOpen)}
                  className={[
                    "inline-flex items-center justify-center rounded-md border px-2 py-1 text-xs font-semibold transition-colors min-w-[56px]",
                    "focus:outline-none focus:ring-0",
                    isOpen
                      ? "bg-white text-black border-white"
                      : "bg-black text-white border-white/30",
                    isBusy || !customerId
                      ? "opacity-60 cursor-not-allowed"
                      : "hover:border-white",
                  ].join(" ")}
                  title={
                    isOpen
                      ? "Click to restore upstream state and clear drift"
                      : "Click to force upstream drift state"
                  }
                >
                  {isBusy ? "…" : label}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
