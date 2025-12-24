"use client";

import { useState } from "react";

export default function CloseAlertButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);

  async function close() {
    setLoading(true);
    try {
      const res = await fetch("/api/alerts/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Failed");
      window.location.reload();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={close}
      disabled={loading}
      className="rounded-md border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
    >
      {loading ? "Closing..." : "Close"}
    </button>
  );
}
