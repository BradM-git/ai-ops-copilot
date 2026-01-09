// src/app/debug/page.tsx
"use client";

import { useEffect, useState } from "react";
import CloseAlertButton from "@/components/CloseAlertButton";

type AlertRow = {
  id: string;
  customer_id: string;
  type: string;
  status: string;
  amount_at_risk: number | null;
  source_system: string | null;
  created_at: string;
};

function fmtMoney(cents: number | null) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function DebugPage() {
  const [enabled, setEnabled] = useState(true);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  async function refresh() {
    setLoading(true);
    setMsg("");

    try {
      const res = await fetch("/api/debug/alerts/list", { method: "GET" });

      if (!res.ok) {
        // In prod, debug is often disabled (404). In dev it should be enabled.
        setEnabled(false);
        return;
      }

      const data = await res.json();
      setEnabled(true);
      setCustomerId(data.customerId || null);
      setAlerts((data.alerts || []) as AlertRow[]);
    } catch (e: any) {
      setMsg(e?.message || "Failed to load debug data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <main className="px-0 space-y-4">
      {msg ? (
        <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface)] px-4 py-3 text-sm text-[var(--ops-text)]">
          {msg}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--ops-text-faint)]">
          customer {customerId ? `${customerId.slice(0, 8)}…` : "—"}
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="ops-cta-secondary text-xs font-semibold disabled:opacity-60"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)]">
        <div className="grid grid-cols-12 border-b border-[var(--ops-border)] bg-[var(--ops-surface)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
          <div className="col-span-4">Type</div>
          <div className="col-span-2">Source</div>
          <div className="col-span-2">Amount</div>
          <div className="col-span-2">Created</div>
          <div className="col-span-2 text-right">Action</div>
        </div>

        {alerts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[var(--ops-text-muted)]">
            No open alpha alerts for this customer.
          </div>
        ) : (
          alerts.map((a) => (
            <div
              key={a.id}
              className="grid grid-cols-12 items-center border-b border-[var(--ops-border)]/60 px-4 py-4 last:border-b-0"
            >
              <div className="col-span-4">
                <div className="text-sm font-semibold text-[var(--ops-text)]">{a.type}</div>
                <div className="mt-1 text-xs text-[var(--ops-text-faint)]">
                  {a.status} · id {a.id.slice(0, 8)}…
                </div>
              </div>

              <div className="col-span-2">
                <div className="text-sm text-[var(--ops-text)]">{a.source_system || "—"}</div>
              </div>

              <div className="col-span-2">
                <div className="text-sm text-[var(--ops-text)]">{fmtMoney(a.amount_at_risk)}</div>
              </div>

              <div className="col-span-2">
                <div className="text-sm text-[var(--ops-text)]">
                  {a.created_at ? new Date(a.created_at).toLocaleString() : "—"}
                </div>
              </div>

              <div className="col-span-2 flex justify-end">
                <CloseAlertButton alertId={a.id} />
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
