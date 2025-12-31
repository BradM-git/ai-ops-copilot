// src/app/debug/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type AlertRow = {
  id: string;
  customer_id: string;
  type: string;
  status: string;
  amount_at_risk: number | null;
  source_system: string | null;
  created_at: string;
};

function keyForAlertType(type: string): string | null {
  if (type === "missed_expected_payment") return "stripe.missed_expected_payment";
  if (type === "payment_amount_drift") return "stripe.payment_amount_drift";
  if (type === "no_recent_client_activity") return "jira.no_recent_client_activity";
  return null;
}

export default function DebugPage() {
  const enabled = process.env.NEXT_PUBLIC_DEBUG_FIXTURES_ENABLED === "true";

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string>("");

  async function refresh() {
    setMsg("");
    const res = await fetch("/api/debug/alerts/list", { method: "GET" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json?.error ? String(json.error) : "Failed to load alerts");
      return;
    }
    setAlerts((json?.alerts || []) as AlertRow[]);
  }

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled]);

  const rows = useMemo(() => {
    return alerts.map((a) => {
      const key = keyForAlertType(a.type);
      const supported = Boolean(key);
      return { alert: a, key, supported };
    });
  }, [alerts]);

  async function toggleAlert(alertId: string, key: string, enabledToggle: boolean, targetId: string) {
    setBusy((b) => ({ ...b, [alertId]: true }));
    setMsg("");

    try {
      const res = await fetch("/api/debug/toggles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, enabled: enabledToggle, alertId, targetId }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(json?.error ? String(json.error) : "Toggle failed");
        return;
      }

      setMsg(
        `OK: ${enabledToggle ? "FORCED" : "RESTORED"} ${key} for customer ${json?.targetId}. Generator: created=${
          json?.generator?.created ?? "?"
        }, updated=${json?.generator?.updated ?? "?"}, resolved=${json?.generator?.resolved ?? "?"}`
      );

      await refresh();
    } catch (e: any) {
      setMsg(e?.message || "Toggle failed");
    } finally {
      setBusy((b) => ({ ...b, [alertId]: false }));
    }
  }

  if (!enabled) {
    return (
      <main className="px-0">
        <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-6">
          <div className="text-sm text-[var(--ops-text-secondary)]">Not found.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="px-0">
      {/* Removed the Debug header + description copy */}

      {msg ? (
        <div className="mb-4 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] px-4 py-3 text-sm text-[var(--ops-text)]">
          {msg}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)]">
        <div className="grid grid-cols-12 border-b border-[var(--ops-border)] bg-white/60 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
          <div className="col-span-3">Alert</div>
          <div className="col-span-3">Type</div>
          <div className="col-span-2">Source</div>
          <div className="col-span-2">Created</div>
          <div className="col-span-2 text-right">Toggle</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[var(--ops-text-secondary)]">No alerts found.</div>
        ) : (
          rows.map(({ alert, key, supported }) => {
            const isBusy = Boolean(busy[alert.id]);
            const isOpen = alert.status === "open";
            const label = isOpen ? "ON" : "OFF";

            return (
              <div
                key={alert.id}
                className="grid grid-cols-12 items-center border-b border-[var(--ops-border)]/60 px-4 py-4 last:border-b-0"
              >
                <div className="col-span-3">
                  <div className="text-sm font-semibold text-[var(--ops-text)]">{alert.id.slice(0, 8)}…</div>
                  <div className="mt-1 text-xs text-[var(--ops-text-faint)]">customer {alert.customer_id?.slice(0, 8)}…</div>
                </div>

                <div className="col-span-3">
                  <div className="text-sm text-[var(--ops-text)]">{alert.type}</div>
                  <div className="mt-1 text-xs text-[var(--ops-text-faint)]">
                    {alert.amount_at_risk != null ? `amount_at_risk=${alert.amount_at_risk}` : "amount_at_risk=—"}
                  </div>
                </div>

                <div className="col-span-2">
                  <div className="text-sm text-[var(--ops-text)]">{alert.source_system || "—"}</div>
                  <div className="mt-1 text-xs text-[var(--ops-text-faint)]">{alert.status}</div>
                </div>

                <div className="col-span-2">
                  <div className="text-sm text-[var(--ops-text)]">{new Date(alert.created_at).toLocaleString()}</div>
                </div>

                <div className="col-span-2 flex justify-end">
                  {supported && key ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => toggleAlert(alert.id, key, !isOpen, alert.customer_id)}
                      className={[
                        "ops-cta",
                        isOpen ? "bg-emerald-600 text-white border-transparent hover:opacity-95" : "bg-[var(--ops-accent-dark)] text-white border-transparent hover:opacity-95",
                        isBusy ? "opacity-60 cursor-not-allowed" : "",
                      ].join(" ")}
                      title={isOpen ? "Click to restore upstream state and clear drift" : "Click to force upstream drift state"}
                    >
                      {isBusy ? "…" : label}
                    </button>
                  ) : (
                    <span className="text-xs text-[var(--ops-text-faint)]">No toggle handler</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
