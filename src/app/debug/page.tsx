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
  // Stable keys that map to mutation handlers in /api/debug/toggles
  if (type === "missed_expected_payment") return "stripe.missed_expected_payment";
  if (type === "payment_amount_drift") return "stripe.payment_amount_drift";
  if (type === "no_recent_client_activity") return "jira.no_recent_client_activity";
  return null;
}

export default function DebugPage() {
  // Client-side gate (so it works with your current client component)
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
    // Looks like it doesn't exist
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <div className="text-sm text-slate-700">Not found.</div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Debug</h1>
        <p className="mt-2 text-sm text-slate-600">
          One row per REAL alert slot (latest per customer + type). Toggles mutate REAL upstream inputs for that alert’s
          customer and then run the real generator.
        </p>
      </div>

      {msg ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">{msg}</div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <div className="col-span-3">Alert</div>
          <div className="col-span-3">Type</div>
          <div className="col-span-2">Source</div>
          <div className="col-span-2">Created</div>
          <div className="col-span-2 text-right">Toggle</div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-600">No alerts found.</div>
        ) : (
          rows.map(({ alert, key, supported }) => {
            const isBusy = Boolean(busy[alert.id]);
            const isOpen = alert.status === "open";
            const label = isOpen ? "ON" : "OFF";

            return (
              <div
                key={alert.id}
                className="grid grid-cols-12 items-center px-4 py-4 border-b border-slate-100 last:border-b-0"
              >
                <div className="col-span-3">
                  <div className="text-sm font-semibold text-slate-900">{alert.id.slice(0, 8)}…</div>
                  <div className="mt-1 text-xs text-slate-500">customer {alert.customer_id?.slice(0, 8)}…</div>
                </div>

                <div className="col-span-3">
                  <div className="text-sm text-slate-900">{alert.type}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {alert.amount_at_risk != null ? `amount_at_risk=${alert.amount_at_risk}` : "amount_at_risk=—"}
                  </div>
                </div>

                <div className="col-span-2">
                  <div className="text-sm text-slate-900">{alert.source_system || "—"}</div>
                  <div className="mt-1 text-xs text-slate-500">{alert.status}</div>
                </div>

                <div className="col-span-2">
                  <div className="text-sm text-slate-900">{new Date(alert.created_at).toLocaleString()}</div>
                </div>

                <div className="col-span-2 flex justify-end">
                  {supported && key ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => toggleAlert(alert.id, key, !isOpen, alert.customer_id)}
                      className={[
                        "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold",
                        isOpen
                          ? "bg-emerald-600 text-white hover:bg-emerald-500"
                          : "bg-slate-900 text-white hover:bg-slate-800",
                        isBusy ? "opacity-60 cursor-not-allowed" : "",
                      ].join(" ")}
                      title={isOpen ? "Click to restore upstream state and clear drift" : "Click to force upstream drift state"}
                    >
                      {isBusy ? "…" : label}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500">No toggle handler</span>
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
