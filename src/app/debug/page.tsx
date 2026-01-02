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

type DebugKey = "stripe.missed_expected_payment" | "stripe.payment_amount_drift" | "jira.no_recent_client_activity";

type DebugRow = {
  key: DebugKey;
  label: string;
  type: string; // alert.type
  source: string;
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
];

export default function DebugPage() {
  const enabled = process.env.NEXT_PUBLIC_DEBUG_FIXTURES_ENABLED === "true";

  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [customerId, setCustomerId] = useState<string>("");
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

    setCustomerId(String(json?.customerId || ""));
    setAlerts((json?.alerts || []) as AlertRow[]);
  }

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled]);

  const byType = useMemo(() => {
    const map = new Map<string, AlertRow>();
    for (const a of alerts) {
      // list endpoint returns latest per type already, but keep safe
      if (!map.has(a.type)) map.set(a.type, a);
    }
    return map;
  }, [alerts]);

  const rows = useMemo(() => {
    return SUPPORTED.map((s) => {
      const existing = byType.get(s.type) || null;
      const isOpen = existing?.status === "open";
      return { spec: s, existing, isOpen };
    });
  }, [byType]);

  async function toggleKey(key: DebugKey, enabledToggle: boolean) {
    setBusy((b) => ({ ...b, [key]: true }));
    setMsg("");

    try {
      if (!customerId) {
        setMsg("Missing customerId (debug list did not return it).");
        return;
      }

      const res = await fetch("/api/debug/toggles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // IMPORTANT: alertId is intentionally omitted so you can force-create alerts from zero state
        body: JSON.stringify({ key, enabled: enabledToggle, targetId: customerId }),
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
      setBusy((b) => ({ ...b, [key]: false }));
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
      {msg ? (
        <div className="mb-4 rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] px-4 py-3 text-sm text-[var(--ops-text)]">
          {msg}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)]">
        <div className="grid grid-cols-12 border-b border-[var(--ops-border)] bg-white/60 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
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
                <div className="text-sm font-semibold text-[var(--ops-text)]">{spec.label}</div>
                <div className="mt-1 text-xs text-[var(--ops-text-faint)]">
                  customer {customerId ? `${customerId.slice(0, 8)}…` : "—"}
                </div>
              </div>

              <div className="col-span-3">
                <div className="text-sm text-[var(--ops-text)]">{spec.type}</div>
                <div className="mt-1 text-xs text-[var(--ops-text-faint)]">
                  {existing?.amount_at_risk != null ? `amount_at_risk=${existing.amount_at_risk}` : "amount_at_risk=—"}
                </div>
              </div>

              <div className="col-span-2">
                <div className="text-sm text-[var(--ops-text)]">{spec.source}</div>
                <div className="mt-1 text-xs text-[var(--ops-text-faint)]">{existing?.status || "—"}</div>
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
                    "ops-cta",
                    isOpen
                      ? "bg-emerald-600 text-white border-transparent hover:opacity-95"
                      : "bg-[var(--ops-accent-dark)] text-white border-transparent hover:opacity-95",
                    isBusy || !customerId ? "opacity-60 cursor-not-allowed" : "",
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
