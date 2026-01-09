// src/components/QuickBooksInvoiceIgnoreButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function QuickBooksInvoiceIgnoreButton(props: {
  alertId: string;
  invoiceId: string;
  ignored: boolean;
}) {
  const { alertId, invoiceId, ignored } = props;
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onClick() {
    if (busy) return;
    setBusy(true);

    try {
      const res = await fetch("/api/alerts/quickbooks-overdue/ignore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alertId,
          invoiceId,
          mode: ignored ? "unignore" : "ignore",
        }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Request failed");
      }

      // Re-fetch server component data without full reload
      router.refresh();
    } catch (e) {
      console.error(e);
      alert("Failed to update invoice status. Check console for details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold ${
        ignored
          ? "border border-[var(--ops-border)] text-[var(--ops-text-muted)] hover:opacity-80"
          : "border border-[var(--ops-accent)] text-[var(--ops-text)] hover:opacity-80"
      } ${busy ? "opacity-60" : ""}`}
    >
      {ignored ? "Undo" : "Not an issue"}
    </button>
  );
}
