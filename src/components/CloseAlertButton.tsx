// src/components/CloseAlertButton.tsx
"use client";

import { useState } from "react";

export default function CloseAlertButton({ alertId }: { alertId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClose() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/alerts/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `HTTP ${res.status}`);
      }

      setDone(true);
      // Let server-rendered list refresh naturally on next navigation/refresh.
      // If you want instant removal without client state, we can add router.refresh().
    } catch (e: any) {
      setErr(e?.message || "Failed to close");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClose}
        disabled={loading || done}
        className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        title="Use only if this is not actually an issue. Prefer letting items auto-resolve."
      >
        {done ? "Marked" : loading ? "Marking…" : "Mark as not an issue"}
      </button>
      {err ? <span className="text-xs text-red-600">{err}</span> : null}
    </div>
  );
}
