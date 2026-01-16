"use client";

import CloseAlertButton from "@/components/CloseAlertButton";

export default function Alert(props: {
  alertId: string;

  // click-through (Option A)
  href: string | null;

  // styling / grouping
  railClassName: string;
  isFirstRow: boolean;

  // content (2 rows only)
  integrationName: string; // e.g. "QuickBooks", "Notion"
  issueSummary: string; // e.g. "Overdue invoices"
  severityBadgeClassName: string; // bg + text classes
  severityLabel: string; // "Critical" | "High" | "Medium" | "Low"
  issueSpecifics: string; // e.g. "7 invoices - $2,032 outstanding - 57 d overdue (max)"
}) {
  const {
    alertId,
    href,
    railClassName,
    isFirstRow,
    integrationName,
    issueSummary,
    severityBadgeClassName,
    severityLabel,
    issueSpecifics,
  } = props;

  const rowClickable = Boolean(href);

  function open() {
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      className={`relative group ${railClassName} ${
        isFirstRow ? "" : "border-t border-t-[var(--ops-border)]"
      } ${rowClickable ? "cursor-pointer" : ""}`}
    >
      {/* Subtle dismiss X (secondary) */}
      <div
        className="absolute right-3 top-3 z-10 opacity-50 transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
        }}
        aria-label="Dismiss alert"
        title="Dismiss"
      >
        <CloseAlertButton alertId={alertId} />
      </div>

      {/* Clickable row */}
      <div
        className={[
          "flex items-center gap-3 px-4 py-3",
          rowClickable ? "hover:bg-[var(--ops-hover)] cursor-pointer" : "",
        ].join(" ")}
        role={rowClickable ? "link" : undefined}
        tabIndex={rowClickable ? 0 : -1}
        onClick={() => open()}
        onKeyDown={(e) => {
          if (!rowClickable) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
      >
        <div className="min-w-0 flex-1 pr-8">
          {/* Row 1: Integration - Issue Summary - Severity */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-semibold text-[var(--ops-text)]">
              {integrationName} — {issueSummary}
            </div>

            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${severityBadgeClassName}`}
              title="Urgency"
            >
              {severityLabel}
            </span>
          </div>

          {/* Row 2: Issue specifics */}
          <div className="mt-1 truncate text-sm text-[var(--ops-text-muted)]">{issueSpecifics}</div>
        </div>
      </div>
    </div>
  );
}
