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

    if (loading || done) return;

    setLoading(true);
    setErr(null);

    try {
      const res = await fetch("/api/alerts/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId }),
      });

      if (!res.ok) throw new Error("Failed");

      setDone(true);
    } catch (e: any) {
      setErr(e?.message || "Error");
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
        className="ops-cta-primary text-xs font-semibold disabled:opacity-60"
        title="Dismiss this alert (use only if this is not actually an issue). Prefer letting items auto-resolve."
      >
        {done ? "Noted" : loading ? "Saving…" : "Dismiss"}
      </button>

      {err ? <span className="text-xs text-[var(--ops-sev-critical)]">{err}</span> : null}
    </div>
  );
}
