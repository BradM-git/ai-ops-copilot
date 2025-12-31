// src/components/CloseAlertButton.tsx
"use client";

import { useState } from "react";

export default function CloseAlertButton({ alertId }: { alertId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClose(e?: React.MouseEvent<HTMLButtonElement>) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

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
    } catch (e: any) {
      setErr(e?.message || "Failed");
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
        className="ops-cta disabled:opacity-60"
        title="Use only if this is not actually an issue. Prefer letting items auto-resolve."
      >
        {done ? "Noted" : loading ? "Saving…" : "Not an issue"}
      </button>

      {err ? <span className="text-xs text-[var(--ops-sev-critical)]">{err}</span> : null}
    </div>
  );
}
