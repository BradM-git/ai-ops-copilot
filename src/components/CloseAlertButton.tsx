// src/components/CloseAlertButton.tsx
"use client";

import { useState } from "react";

export default function CloseAlertButton({ alertId }: { alertId: string }) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClose(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();

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

  if (done) return null;

  return (
    <button
      type="button"
      onClick={onClose}
      disabled={loading}
      aria-label="Dismiss alert"
      title="Dismiss alert"
      className="
        cursor-pointer
        rounded
        p-1
        text-sm
        font-normal
        leading-none
        text-[var(--ops-text-muted)]
        hover:text-[var(--ops-text)]
        hover:bg-[var(--ops-hover)]
        disabled:opacity-40
        disabled:cursor-not-allowed
      "
    >
      {loading ? "…" : "×"}
      {err ? <span className="sr-only">{err}</span> : null}
    </button>
  );
}
