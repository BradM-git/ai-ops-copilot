// src/app/how-it-works/page.tsx
import Link from "next/link";

export const dynamic = "force-static";

export default function HowItWorksPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[var(--ops-text)]">How urgency works</h1>
        <Link
          href="/"
          className="rounded-lg border border-[var(--ops-border)] bg-[var(--ops-surface)] px-3 py-1.5 text-sm text-[var(--ops-text)] hover:bg-[var(--ops-surface-2)]"
        >
          Back to alerts
        </Link>
      </div>

      <div className="mt-6 space-y-6 text-[var(--ops-text)]">
        <section className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-5">
          <h2 className="text-lg font-semibold">What “Urgency” means</h2>
          <p className="mt-2 text-sm text-[var(--ops-text-muted)]">
            Every alert gets an <span className="font-medium text-[var(--ops-text)]">urgency score (0–100)</span>.
            Higher means “a human should look sooner.”
          </p>

          <div className="mt-4 space-y-2 text-sm">
            <div>
              <span className="font-semibold">Critical</span>: score ≥ 90
            </div>
            <div>
              <span className="font-semibold">High</span>: score ≥ 70
            </div>
            <div>
              <span className="font-semibold">Medium</span>: score ≥ 40
            </div>
            <div className="text-[var(--ops-text-muted)]">
              (Below 40 is effectively “Low”. We may surface that label later, but it’s not required for alpha.)
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-5">
          <h2 className="text-lg font-semibold">Two clocks</h2>
          <p className="mt-2 text-sm text-[var(--ops-text-muted)]">
            There are two different timestamps in play — and they have different jobs.
          </p>

          <div className="mt-4 space-y-3 text-sm">
            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-4">
              <div className="font-semibold">1) Alert created time (alerts.created_at)</div>
              <ul className="mt-2 list-disc pl-5 text-[var(--ops-text-muted)]">
                <li>Used for “Most recent” sorting</li>
                <li>Used for the “x ago” timestamp</li>
                <li className="text-[var(--ops-text)]">Not used to calculate urgency</li>
              </ul>
            </div>

            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-4">
              <div className="font-semibold">2) Domain time (inside alert.context)</div>
              <ul className="mt-2 list-disc pl-5 text-[var(--ops-text-muted)]">
                <li>Notion: last edited time / staleness</li>
                <li>QuickBooks: invoice due dates / days overdue</li>
                <li className="text-[var(--ops-text)]">This is what drives urgency</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-5">
          <h2 className="text-lg font-semibold">How we score each alert type</h2>

          <div className="mt-4 space-y-4 text-sm">
            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-4">
              <div className="font-semibold">Notion: stale work</div>
              <p className="mt-2 text-[var(--ops-text-muted)]">
                Notion ramps <span className="font-medium text-[var(--ops-text)]">gently</span> so it doesn’t scream by
                default. It becomes High only when items have been stale for a meaningful amount of time.
              </p>
              <ul className="mt-2 list-disc pl-5 text-[var(--ops-text-muted)]">
                <li>~14 days stale → Medium territory</li>
                <li>~30 days stale → High territory</li>
                <li>~60 days stale → Critical territory</li>
              </ul>
            </div>

            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-4">
              <div className="font-semibold">QuickBooks: overdue invoices</div>
              <p className="mt-2 text-[var(--ops-text-muted)]">
                QuickBooks urgency is driven primarily by{" "}
                <span className="font-medium text-[var(--ops-text)]">how overdue</span> the oldest invoice is, with a
                secondary bump for total outstanding balance.
              </p>
              <ul className="mt-2 list-disc pl-5 text-[var(--ops-text-muted)]">
                <li>More days overdue → higher urgency</li>
                <li>Higher total balance → higher urgency</li>
              </ul>
            </div>
          </div>

          <p className="mt-4 text-sm text-[var(--ops-text-muted)]">
            This page is intentionally plain English. The exact math is implemented in{" "}
            <span className="font-mono text-xs text-[var(--ops-text)]">src/lib/alertRegistry.ts</span>.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-5">
          <h2 className="text-lg font-semibold">Why this matters</h2>
          <p className="mt-2 text-sm text-[var(--ops-text-muted)]">
            Urgency should feel defensible. If everything is Critical, nothing is. These rules are designed to keep the
            board quiet when healthy, and loud only when the business is drifting.
          </p>
        </section>
      </div>
    </main>
  );
}
