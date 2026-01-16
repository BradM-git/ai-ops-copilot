"use client";

// src/components/AlertCard.tsx
import CloseAlertButton from "@/components/CloseAlertButton";
import OpenPlatformLink from "@/components/OpenPlatformLink";

type Severity = "critical" | "high" | "medium" | "low";
type Cta = { platform: string; href: string };

function severityLabel(sev: Severity) {
  return sev.toUpperCase();
}

function severityBadgeClass(sev: Severity) {
  // Keep it simple: use existing theme tokens and let your CSS variables carry the look.
  // (No new design system here.)
  switch (sev) {
    case "critical":
      return "border-red-500/40 bg-red-500/10 text-red-200";
    case "high":
      return "border-orange-500/40 bg-orange-500/10 text-orange-200";
    case "medium":
      return "border-yellow-500/40 bg-yellow-500/10 text-yellow-200";
    case "low":
    default:
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }
}

export default function AlertCard(props: {
  alertId: string;

  domainLabel: string;
  severity: Severity;
  createdAgo: string;

  title: string; // will become the primary message line
  summary: string; // optional secondary line; keep minimal

  // These remain in props for now to avoid touching upstream callsites.
  // We intentionally do NOT render them (expanded view removed).
  expectation: string;
  observation: string;
  drift: string;
  nextStep: string;

  // Option A: click-through to source system
  collapsedCta: Cta | null;

  // Aggregated QBO props (no longer rendered here)
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
    collapsedCta,
  } = props;

  const clickable = Boolean(collapsedCta?.href);

  return (
    <div
      className={[
        "rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-4",
        clickable ? "cursor-pointer hover:bg-[var(--ops-surface-2)]" : "",
      ].join(" ")}
      role={clickable ? "link" : undefined}
      tabIndex={clickable ? 0 : -1}
      onClick={() => {
        if (!collapsedCta?.href) return;
        window.open(collapsedCta.href, "_blank", "noopener,noreferrer");
      }}
      onKeyDown={(e) => {
        if (!collapsedCta?.href) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          window.open(collapsedCta.href, "_blank", "noopener,noreferrer");
        }
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Row header: domain + time (secondary) */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
            <span>{domainLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{createdAgo}</span>
          </div>

          {/* Urgency + primary message */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={[
                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
                severityBadgeClass(severity),
              ].join(" ")}
              title="Urgency"
            >
              {severityLabel(severity)}
            </span>

            <div className="min-w-0 text-base font-semibold text-[var(--ops-text)]">
              {title}
            </div>
          </div>

          {/* Optional secondary line — keep it short */}
          {summary ? (
            <div className="mt-1 text-sm text-[var(--ops-text-muted)]">
              {summary}
            </div>
          ) : null}
        </div>

        {/* Actions: open in source + close */}
        <div className="flex items-center gap-2">
          {collapsedCta ? (
            <div
              onClick={(e) => {
                // prevent row click from double-opening
                e.preventDefault();
                e.stopPropagation();
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
              }}
            >
              <OpenPlatformLink
                href={collapsedCta.href}
                label={`Open in ${collapsedCta.platform}`}
              />
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
