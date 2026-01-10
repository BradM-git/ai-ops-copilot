"use client";

// src/components/AlertCard.tsx
import { useId, useState } from "react";
import CloseAlertButton from "@/components/CloseAlertButton";
import OpenPlatformLink from "@/components/OpenPlatformLink";
import QuickBooksOverdueInvoicesTable from "@/components/QuickBooksOverdueInvoicesTable";

type Severity = "critical" | "high" | "medium" | "low";
type Cta = { platform: string; href: string };

export default function AlertCard(props: {
  alertId: string;

  domainLabel: string;
  severity: Severity;
  createdAgo: string;

  title: string;
  summary: string;

  expectation: string;
  observation: string;
  drift: string;
  nextStep: string;

  collapsedCta: Cta | null;

  // Aggregated QBO (optional)
  isAggregatedQbo: boolean;
  sortedQboInvoices: any[];
  ignoredInvoiceIds: string[];
}) {
  const {
    alertId,
    domainLabel,
    severity,
    createdAgo,
    title,
    summary,
    expectation,
    observation,
    drift,
    nextStep,
    collapsedCta,
    isAggregatedQbo,
    sortedQboInvoices,
    ignoredInvoiceIds,
  } = props;

  // Collapsed by default
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  return (
    <div className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
            {domainLabel} · {severity.toUpperCase()} · {createdAgo}
          </div>

          <div className="mt-1 text-lg font-semibold text-[var(--ops-text)]">{title}</div>

          <div className="mt-1 text-sm text-[var(--ops-text-muted)]">{summary}</div>
        </div>

        <div className="flex items-center gap-2">
          {collapsedCta ? (
            <OpenPlatformLink href={collapsedCta.href} label={`Open in ${collapsedCta.platform}`} />
          ) : null}

          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            aria-expanded={expanded}
            aria-controls={detailsId}
            className="ops-cta-primary text-xs font-semibold"
            title={expanded ? "Hide details" : "Show details"}
          >
            {expanded ? "Hide details" : "Show details"}
          </button>

          <CloseAlertButton alertId={alertId} />
        </div>
      </div>

      {expanded ? (
        <div id={detailsId} className="mt-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-2">
              <div className="text-xs font-semibold text-[var(--ops-text)]">Expectation</div>
              <div className="mt-1 text-sm text-[var(--ops-text-muted)]">{expectation}</div>
            </div>

            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-2">
              <div className="text-xs font-semibold text-[var(--ops-text)]">Observation</div>
              <div className="mt-1 text-sm text-[var(--ops-text-muted)]">{observation}</div>
            </div>

            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-2">
              <div className="text-xs font-semibold text-[var(--ops-text)]">Why it matters</div>
              <div className="mt-1 text-sm text-[var(--ops-text-muted)]">{drift}</div>
            </div>
          </div>

          <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-2">
            <div className="text-xs font-semibold text-[var(--ops-text)]">Next step</div>
            <div className="mt-1 text-sm text-[var(--ops-text-muted)]">{nextStep}</div>
          </div>

          {isAggregatedQbo && sortedQboInvoices.length > 0 ? (
            <div className="pt-1">
              <QuickBooksOverdueInvoicesTable
                alertId={alertId}
                invoices={sortedQboInvoices}
                ignoredInvoiceIds={ignoredInvoiceIds}
                maxHeightClassName="max-h-72"
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
