"use client";

import CloseAlertButton from "@/components/CloseAlertButton";
import OpenPlatformLink from "@/components/OpenPlatformLink";

export default function Alert(props: {
  alertId: string;

  // click-through (Option A)
  href: string | null;
  openLabel: string | null;

  // styling / grouping
  railClassName: string;
  isFirstRow: boolean;

  // content
  domainLabel: string;
  customerLabel: string;

  severityBadgeClassName: string; // already includes bg + text classes
  severityLabel: string; // "Critical" | "High" | "Medium" | "Low" (currently only first 3 used)

  moneyLabel: string | null;

  title: string; // primary message
  summary: string | null; // secondary (optional)
}) {
  const {
    alertId,
    href,
    openLabel,
    railClassName,
    isFirstRow,
    domainLabel,
    customerLabel,
    severityBadgeClassName,
    severityLabel,
    moneyLabel,
    title,
    summary,
  } = props;

  const rowClickable = Boolean(href);

  function open() {
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <div className={`group ${railClassName} ${isFirstRow ? "" : "border-t border-t-[var(--ops-border)]"}`}>
      <div
        className={[
          "flex items-center gap-3 px-4 py-3",
          rowClickable ? "cursor-pointer hover:bg-[var(--ops-hover)]" : "",
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
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
              {domainLabel} · {customerLabel}
            </div>

            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${severityBadgeClassName}`}
              title="Urgency"
            >
              {severityLabel}
            </span>

            {moneyLabel ? <span className="text-xs text-[var(--ops-text-muted)]">{moneyLabel}</span> : null}
          </div>

          {/* Primary line */}
          <div className="mt-1 truncate text-sm font-semibold text-[var(--ops-text)]">{title}</div>

          {/* Secondary line */}
          {summary ? (
            <div className="mt-0.5 truncate text-sm text-[var(--ops-text-muted)]">{summary}</div>
          ) : null}
        </div>

        {/* Actions: prevent row click */}
        <div className="flex shrink-0 items-center gap-3">
          {href && openLabel ? (
            <div
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
              }}
            >
              <OpenPlatformLink href={href} label={openLabel} />
            </div>
          ) : null}

          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
          >
            <CloseAlertButton alertId={alertId} />
          </div>
        </div>
      </div>
    </div>
  );
}
