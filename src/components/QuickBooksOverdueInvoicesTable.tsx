// src/components/QuickBooksOverdueInvoicesTable.tsx
"use client";

import { useMemo, useState } from "react";
import QuickBooksInvoiceIgnoreButton from "@/components/QuickBooksInvoiceIgnoreButton";

type QboInvoice = {
  invoiceId: string;
  docNumber?: string | null;
  dueDate?: string | null;
  balanceCents?: number | null;
  url?: string | null;
};

function fmtMoney(cents: number | null | undefined) {
  if (!cents) return null;
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtDate(isoOrNull: unknown): string {
  if (!isoOrNull) return "—";
  const d = new Date(String(isoOrNull));
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function outlineButtonClasses() {
  return "inline-flex items-center rounded-lg border border-[var(--ops-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--ops-text)] hover:opacity-80";
}

function subtleToggleButtonClasses() {
  return "inline-flex items-center rounded-lg border border-[var(--ops-border)] px-3 py-1.5 text-xs font-semibold text-[var(--ops-text)] hover:opacity-80";
}

/**
 * Deterministic header/body layout:
 * - header table is NOT inside the scroller
 * - body table is inside the scroller
 * - shared colgroup + table-fixed keep perfect alignment
 * This avoids sticky-header overlap/clipping issues.
 */
export default function QuickBooksOverdueInvoicesTable(props: {
  alertId: string;
  invoices: QboInvoice[];
  ignoredInvoiceIds: string[];
  maxHeightClassName?: string;
}) {
  const { alertId, invoices, ignoredInvoiceIds, maxHeightClassName } = props;
  const [showIgnored, setShowIgnored] = useState(false);

  const ignoredSet = useMemo(() => new Set(ignoredInvoiceIds.map(String)), [ignoredInvoiceIds]);

  const { visible, ignoredCount } = useMemo(() => {
    const ignoredCount0 = invoices.reduce(
      (n, inv) => (inv.invoiceId && ignoredSet.has(String(inv.invoiceId)) ? n + 1 : n),
      0
    );

    if (showIgnored) return { visible: invoices, ignoredCount: ignoredCount0 };

    return {
      visible: invoices.filter((inv) => inv.invoiceId && !ignoredSet.has(String(inv.invoiceId))),
      ignoredCount: ignoredCount0,
    };
  }, [invoices, ignoredSet, showIgnored]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
          Overdue invoices ({visible.length})
          {ignoredCount > 0 && !showIgnored ? (
            <span className="ml-2 normal-case text-[var(--ops-text-muted)]">
              {ignoredCount} hidden
            </span>
          ) : null}
        </div>

        {ignoredCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowIgnored((v) => !v)}
            className={subtleToggleButtonClasses()}
          >
            {showIgnored ? `Hide ignored (${ignoredCount})` : `Show ignored (${ignoredCount})`}
          </button>
        ) : null}
      </div>

      <div className="mt-2 overflow-hidden rounded-xl border border-[var(--ops-border)]">
        {/* Header table (non-scrolling) */}
        <div className="border-b border-b-[var(--ops-border)] bg-[var(--ops-surface)]">
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[22%]" />
              <col className="w-[18%]" />
              <col className="w-[28%]" />
            </colgroup>
            <thead>
              <tr className="text-xs text-[var(--ops-text-faint)]">
                <th className="px-3 py-2 font-semibold">Invoice</th>
                <th className="px-3 py-2 font-semibold">Due</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
          </table>
        </div>

        {/* Body table (scrolling) */}
        <div className={`overflow-auto ${maxHeightClassName || "max-h-72"}`}>
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[32%]" />
              <col className="w-[22%]" />
              <col className="w-[18%]" />
              <col className="w-[28%]" />
            </colgroup>

            <tbody>
              {visible.map((i, n) => {
                const invoiceId = String(i?.invoiceId ?? "");
                const href = typeof i?.url === "string" ? i.url : null;
                const doc = String(i?.docNumber ?? invoiceId ?? "—");
                const due = fmtDate(i?.dueDate ?? null);
                const bal = fmtMoney(typeof i?.balanceCents === "number" ? i.balanceCents : null);
                const ignored = invoiceId ? ignoredSet.has(invoiceId) : false;

                return (
                  <tr
                    key={`${invoiceId || doc}:${n}`}
                    className={`border-b border-b-[var(--ops-border)] last:border-b-0 ${
                      ignored ? "opacity-60" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      {href ? (
                        <a
                          className="truncate font-semibold text-[var(--ops-text)] underline decoration-[var(--ops-border)] underline-offset-2 hover:opacity-80"
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          title={doc}
                        >
                          {doc}
                        </a>
                      ) : (
                        <span className="truncate font-semibold text-[var(--ops-text)]" title={doc}>
                          {doc}
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-2 text-[var(--ops-text-muted)]">{due}</td>

                    <td className="px-3 py-2 text-right text-[var(--ops-text)]">{bal ?? "—"}</td>

                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-2">
                        {href ? (
                          <a
                            className={outlineButtonClasses()}
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open in QuickBooks
                          </a>
                        ) : null}

                        {invoiceId ? (
                          <QuickBooksInvoiceIgnoreButton
                            alertId={alertId}
                            invoiceId={invoiceId}
                            ignored={ignored}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {visible.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-[var(--ops-text-muted)]">
                    No overdue invoices to show.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
