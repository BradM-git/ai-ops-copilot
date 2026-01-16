// src/app/how-it-works/page.tsx
export const dynamic = "force-static";

export default function HowItWorksPage() {
  return (
    <main className="w-full px-4 py-10 text-[var(--ops-text)]">
      <div className="space-y-6">
        {/* Intro */}
        <section className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-5">
          <p className="text-sm text-[var(--ops-text-muted)]">
            This page explains how alerts are ordered and why some appear more urgent than others. The goal is simple:
            surface the few things that actually need attention, and stay quiet when the business is healthy.
          </p>
        </section>

        {/* Urgency basics */}
        <section className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">Urgency</h2>

          <p className="mt-3 text-sm text-[var(--ops-text-muted)]">
            Every alert gets a single <span className="font-medium text-[var(--ops-text)]">urgency score (0–100)</span>.
            Higher means it should be looked at sooner.
          </p>

          <div className="mt-4 space-y-1 text-sm">
            <div>
              <strong>Critical</strong>: score ≥ 80
            </div>
            <div>
              <strong>High</strong>: score ≥ 60
            </div>
            <div>
              <strong>Medium</strong>: score ≥ 40
            </div>
            <div>
              <strong>Low</strong>: score &lt; 40
            </div>
          </div>

          <p className="mt-4 text-sm text-[var(--ops-text-muted)]">
            If everything were Critical, the system wouldn’t be useful. These thresholds are intentionally conservative.
          </p>
        </section>

        {/* Sorting */}
        <section className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">Sorting</h2>

          <div className="mt-3 grid gap-3 md:grid-cols-2 text-sm">
            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-4">
              <div className="font-medium">Sort by Urgency</div>
              <div className="mt-1 text-[var(--ops-text-muted)]">
                Highest urgency score first. If two alerts have the same score, the newer one appears first.
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-4">
              <div className="font-medium">Sort by Most recent</div>
              <div className="mt-1 text-[var(--ops-text-muted)]">
                Newest alerts first, based on when the alert was created — not how overdue or severe it is.
              </div>
            </div>
          </div>
        </section>

        {/* What drives the score */}
        <section className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
            What affects urgency
          </h2>

          <p className="mt-3 text-sm text-[var(--ops-text-muted)]">Urgency is driven by two things:</p>

          <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm">
            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-4">
              <div className="font-medium">Time risk</div>
              <div className="mt-1 text-[var(--ops-text-muted)]">
                The longer something has been overdue or inactive, the higher the urgency.
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-4">
              <div className="font-medium">Impact</div>
              <div className="mt-1 text-[var(--ops-text-muted)]">More money at risk increases urgency.</div>
            </div>
          </div>

          <p className="mt-4 text-sm text-[var(--ops-text-muted)]">
            The alert’s creation time is <strong>not</strong> used to calculate urgency. It’s only used for sorting and
            display.
          </p>
        </section>

        {/* Examples */}
        <section className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">Examples</h2>

          <div className="mt-4 grid gap-3 md:grid-cols-2 text-sm">
            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-4">
              <div className="font-medium">Notion: stale work</div>
              <ul className="mt-2 list-disc pl-5 text-[var(--ops-text-muted)]">
                <li>A few items stale for ~2 weeks → usually Medium</li>
                <li>Stale for ~1 month → often High</li>
                <li>Long-running staleness or many items → can become Critical</li>
              </ul>
            </div>

            <div className="rounded-xl border border-[var(--ops-border)] bg-[var(--ops-surface-2)] p-4">
              <div className="font-medium">QuickBooks: overdue invoices</div>
              <ul className="mt-2 list-disc pl-5 text-[var(--ops-text-muted)]">
                <li>More days overdue → higher urgency</li>
                <li>Larger balances → higher urgency</li>
                <li>Very overdue, high-value invoices rise quickly</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Confidence */}
        <section className="rounded-2xl border border-[var(--ops-border)] bg-[var(--ops-surface)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ops-text-faint)]">
            About confidence
          </h2>

          <p className="mt-3 text-sm text-[var(--ops-text-muted)]">
            There is one primary signal to trust: <strong>urgency score → severity</strong>.
          </p>

          <p className="mt-3 text-sm text-[var(--ops-text-muted)]">
            Any other mentions of “confidence” are legacy and should be treated as explanatory, not as a separate ranking
            system.
          </p>
        </section>
      </div>
    </main>
  );
}
