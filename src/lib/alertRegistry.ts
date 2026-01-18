// src/lib/alertRegistry.ts

export type Severity = "critical" | "high" | "medium" | "low";

export type AlertRow = {
  id: string;
  customer_id: string;
  type: string;
  message: string | null;
  status: string;
  created_at: string;
  source_system: string | null;
  amount_at_risk: number | null;

  // optional fields used by some alert types
  expected_amount_cents?: number | null;
  observed_amount_cents?: number | null;
  expected_at?: string | null;
  observed_at?: string | null;

  confidence?: number | null;
  confidence_reason?: string | null;

  primary_entity_type?: string | null;
  primary_entity_id?: string | null;

  context?: any;
};

export type CustomerRow = {
  id: string;
  name?: string | null;
  email?: string | null;
};

export type ExpectedRevenueRow = {
  customer_id: string;
  amount_cents: number;
  cadence: string;
};

export type InvoiceRow = {
  customer_id: string;
  created_at: string;
  status?: string | null;
  stripe_invoice_id?: string | null;
  invoice_date?: string | null;
  paid_at?: string | null;
};

export type PaymentRow = {
  customer_id: string;
  created_at: string;
  paid_at?: string | null;
};

export type AlertPresentation = {
  domainLabel: string;
  title: string;
  summary: string;
  expectation: string;
  observation: string;
  drift: string;
  nextStep: string;
  confidenceLabel: string;
  score: number;
};

function formatDateShort(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtMoneyCents(cents: number | null | undefined) {
  const n = Number(cents ?? 0);
  if (!Number.isFinite(n) || n === 0) return "$0";
  return (n / 100).toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function confidenceLabelFromAlert(confidence: number, reason?: string | null) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return "—";
  const pct = `${Math.round(c * 100)}%`;
  return reason ? `${pct} (${reason})` : pct;
}

function confidenceScore(confidence: number | null | undefined, expected: number | null | undefined) {
  // Keep existing behavior (lightweight impact) — do not overhaul scoring here.
  const c = typeof confidence === "number" ? confidence : null;
  if (c == null) return 0;
  const e = typeof expected === "number" ? expected : null;
  if (e == null) return Math.round(c * 10);
  const delta = Math.max(0, c - e);
  return Math.round(delta * 20);
}

function impactScore(amountAtRiskCents: number) {
  // Keep existing behavior.
  if (amountAtRiskCents >= 250_000_00) return 20;
  if (amountAtRiskCents >= 100_000_00) return 15;
  if (amountAtRiskCents >= 25_000_00) return 10;
  if (amountAtRiskCents >= 5_000_00) return 6;
  if (amountAtRiskCents > 0) return 3;
  return 0;
}

function overdueScore(overdueDays: number | null) {
  if (overdueDays == null) return 0;
  if (overdueDays >= 30) return 20;
  if (overdueDays >= 14) return 14;
  if (overdueDays >= 7) return 10;
  if (overdueDays >= 3) return 6;
  if (overdueDays >= 1) return 3;
  return 0;
}

function scoreNotionStale(ctx: any): number {
  // Existing behavior (unchanged)
  const count = typeof ctx?.count === "number" ? ctx.count : Array.isArray(ctx?.items) ? ctx.items.length : 0;
  const maxStaleDays = typeof ctx?.max_stale_days === "number" ? ctx.max_stale_days : 0;

  let score = 30;
  if (count >= 10) score += 30;
  else if (count >= 5) score += 20;
  else if (count >= 1) score += 10;

  if (maxStaleDays >= 45) score += 30;
  else if (maxStaleDays >= 30) score += 20;
  else if (maxStaleDays >= 14) score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * notion_stale_past_due scoring
 *
 * Uses:
 * - grace_days (context.grace_days; fallback 3)
 * - overdue_count (context.total|count|items.length)
 * - worst_overdue_days (max days overdue among context.items due dates, if available)
 *
 * Shape assumptions (best-effort, backward compatible):
 * - context.items[] may include a due date under one of these keys:
 *   - due_date, dueDate, due, due_at, dueAt
 *   - or nested like item.due.date / item.dueDate / item.properties?.Due Date?.date?.start (Notion raw-ish)
 * If due dates aren’t present, scoring falls back to count + grace-only.
 */
function scoreNotionPastDue(ctx: any): number {
  const graceDays = typeof ctx?.grace_days === "number" ? ctx.grace_days : 3;

  const total =
    typeof ctx?.total === "number"
      ? ctx.total
      : typeof ctx?.count === "number"
        ? ctx.count
        : Array.isArray(ctx?.items)
          ? ctx.items.length
          : 0;

  const items: any[] = Array.isArray(ctx?.items) ? ctx.items : [];

  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;

  const extractDueIso = (item: any): string | null => {
    if (!item || typeof item !== "object") return null;

    const direct =
      typeof item.due_date === "string"
        ? item.due_date
        : typeof item.dueDate === "string"
          ? item.dueDate
          : typeof item.due === "string"
            ? item.due
            : typeof item.due_at === "string"
              ? item.due_at
              : typeof item.dueAt === "string"
                ? item.dueAt
                : null;

    if (direct) return direct;

    // common nested shapes
    const nested1 = typeof item?.due?.date === "string" ? item.due.date : null;
    if (nested1) return nested1;

    const nested2 = typeof item?.due?.start === "string" ? item.due.start : null;
    if (nested2) return nested2;

    const nested3 = typeof item?.properties?.["Due Date"]?.date?.start === "string"
      ? item.properties["Due Date"].date.start
      : null;
    if (nested3) return nested3;

    const nested4 = typeof item?.properties?.Due?.date?.start === "string" ? item.properties.Due.date.start : null;
    if (nested4) return nested4;

    return null;
  };

  let worstOverdueDays: number | null = null;

  for (const it of items) {
    const dueIso = extractDueIso(it);
    if (!dueIso) continue;

    const due = new Date(dueIso);
    if (isNaN(due.getTime())) continue;

    const days = Math.floor((now.getTime() - due.getTime()) / msPerDay);
    // we only care about overdue > 0
    if (days <= 0) continue;

    if (worstOverdueDays == null || days > worstOverdueDays) worstOverdueDays = days;
  }

  // Model:
  // - base 50
  // - +10 per overdue task (cap +30)
  // - +5 per day beyond grace for worst overdue (cap +40)
  // - clamp 0..100
  let score = 50;

  // count component
  score += clamp(total, 0, 3) * 10; // 0..30

  // worst overdue component (beyond grace)
  if (worstOverdueDays != null) {
    const beyondGrace = Math.max(0, worstOverdueDays - graceDays);
    score += clamp(beyondGrace, 0, 8) * 5; // 0..40
  }

  return clamp(Math.round(score), 0, 100);
}

/**
 * qbo_overdue_invoice scoring
 *
 * Supports BOTH:
 * - legacy aggregated shape: context.invoices[] with { dueDate, balanceCents }
 * - new per-invoice shape: context.invoice with { dueDate, balanceCents }
 */
function scoreQboOverdueInvoice(ctx: any): number {
  const now = new Date();

  // New per-invoice shape
  const single = ctx?.invoice && typeof ctx.invoice === "object" ? ctx.invoice : null;
  if (single) {
    const bal = Number(single?.balanceCents ?? 0);
    const due = typeof single?.dueDate === "string" ? new Date(single.dueDate) : null;

    let daysOverdue: number | null = null;
    if (due && !isNaN(due.getTime())) {
      const d = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      daysOverdue = d > 0 ? d : 0;
    }

    // Base + amount + overdue
    let score = 40;
    score += impactScore(bal);
    score += overdueScore(daysOverdue);

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // Legacy aggregated shape
  const invoices: any[] = Array.isArray(ctx?.invoices) ? ctx.invoices : [];
  if (invoices.length === 0) return 0;

  let totalBalanceCents = 0;
  let maxDaysOverdue: number | null = null;

  for (const inv of invoices) {
    const bal = Number(inv?.balanceCents ?? 0);
    if (bal > 0) totalBalanceCents += bal;

    const due = typeof inv?.dueDate === "string" ? new Date(inv.dueDate) : null;
    if (due && !isNaN(due.getTime())) {
      const d = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      if (maxDaysOverdue == null || d > maxDaysOverdue) maxDaysOverdue = d;
    }
  }

  let score = 40;
  score += impactScore(totalBalanceCents);
  score += overdueScore(maxDaysOverdue);

  // small nudge for multiple invoices (legacy behavior)
  if (invoices.length >= 5) score += 6;
  else if (invoices.length >= 2) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreFromRegistry(params: {
  alert: AlertRow;
  severity: Severity;
  overdueDays: number | null;
  expectedConfidenceFloat?: number | null;
}): number {
  // NOTE: keep existing score weighting logic; only QBO scorer changed above.
  const sevBase = params.severity === "critical" ? 60 : params.severity === "high" ? 45 : 30;
  const amt = Number(params.alert.amount_at_risk ?? 0);

  const score =
    sevBase +
    confidenceScore(params.alert.confidence, params.expectedConfidenceFloat) +
    impactScore(amt) +
    overdueScore(params.overdueDays);

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function presentAlert(params: {
  alert: AlertRow;
  customer: CustomerRow | null;
  expected: ExpectedRevenueRow | null;
  latestInvoice: InvoiceRow | null;
  latestPayment: PaymentRow | null;
  overdueDays: number | null;
  severity?: Severity;
}): AlertPresentation {
  const a = params.alert;
  const cust = params.customer;
  const exp = params.expected;
  const inv = params.latestInvoice;
  const pay = params.latestPayment;

  const name = cust?.name || cust?.email || "Customer";
  const amountAtRisk = Number(a.amount_at_risk ?? 0);

  const confidenceLabel = a.confidence ? confidenceLabelFromAlert(a.confidence, a.confidence_reason) : "—";

  switch (a.type) {
    case "notion_stale_activity": {
      const domainLabel = "Delivery";

      const ctx: any = a.context ?? {};
      const count = typeof ctx.count === "number" ? ctx.count : Array.isArray(ctx.items) ? ctx.items.length : null;
      const maxStaleDays = typeof ctx.max_stale_days === "number" ? ctx.max_stale_days : null;

      const title = "Stale Notion items";
      const summaryParts = [
        typeof count === "number" ? `${count} item${count === 1 ? "" : "s"}` : null,
        typeof maxStaleDays === "number" ? `up to ${maxStaleDays}d stale` : null,
      ].filter(Boolean);
      const summary = summaryParts.length ? summaryParts.join(" · ") : a.message || "Notion items may be stale.";

      const threshold = typeof ctx.stale_threshold_days === "number" ? ctx.stale_threshold_days : 14;

      const expectation = `Active projects should show visible progress at least every ${threshold} days.`;
      const observation =
        typeof count === "number" && count > 0
          ? `We found ${count} Notion page${count === 1 ? "" : "s"} with no edits in ${threshold}+ days.`
          : "No stale Notion pages detected.";

      const drift = "When work goes quiet, it’s easy for delivery risk to build without anyone noticing.";

      const nextStep =
        "Open the stale pages and confirm whether work is happening elsewhere. If the project is paused, mark it clearly (or move it out of active views).";

      const score = scoreNotionStale(a.context);

      return {
        domainLabel,
        title,
        summary,
        expectation,
        observation,
        drift,
        nextStep,
        confidenceLabel,
        score,
      };
    }

    case "notion_stale_past_due": {
      const domainLabel = "Delivery";

      const ctx: any = a.context ?? {};
      const total =
        typeof ctx?.total === "number"
          ? ctx.total
          : typeof ctx?.count === "number"
            ? ctx.count
            : Array.isArray(ctx?.items)
              ? ctx.items.length
              : 0;

      const graceDays = typeof ctx?.grace_days === "number" ? ctx.grace_days : 3;

      const title = "Missed task deadlines";
      const summary =
        total === 1
          ? `1 task is overdue by at least ${graceDays} days.`
          : `${total} tasks are overdue by at least ${graceDays} days.`;

      const expectation = `Tasks with a due date should not slip beyond ${graceDays} days overdue.`;
      const observation =
        total > 0
          ? `We found ${total} task${total === 1 ? "" : "s"} with Due Date at least ${graceDays} days in the past (and not marked Done).`
          : "No missed task deadlines detected.";

      const drift = "Missed deadlines create delivery risk and often signal that priorities or ownership need attention.";

      const nextStep =
        "Confirm the due date is still valid. If it is, assign an owner and a new committed date (or mark the task Done if it’s complete).";

      // Updated: tighter scoring for missed deadlines (grace days + worst overdue age + count)
      const score = scoreNotionPastDue(ctx);

      return {
        domainLabel,
        title,
        summary,
        expectation,
        observation,
        drift,
        nextStep,
        confidenceLabel,
        score,
      };
    }

    case "qbo_overdue_invoice": {
      const domainLabel = "Revenue";

      const ctx: any = a.context ?? {};

      // New per-invoice shape
      const single = ctx?.invoice && typeof ctx.invoice === "object" ? ctx.invoice : null;
      if (single) {
        const invoiceId = single?.invoiceId ? String(single.invoiceId) : "Invoice";
        const docNumber = single?.docNumber ? String(single.docNumber) : null;
        const dueDate = typeof single?.dueDate === "string" ? single.dueDate : null;
        const balanceCents = Number(single?.balanceCents ?? 0);

        const label = docNumber ? `Invoice ${docNumber}` : `Invoice ${invoiceId}`;

        let daysOverdue: number | null = null;
        if (dueDate) {
          const due = new Date(dueDate);
          if (!isNaN(due.getTime())) {
            const d = Math.floor((Date.now() - due.getTime()) / (1000 * 60 * 60 * 24));
            daysOverdue = d > 0 ? d : 0;
          }
        }

        const title = "Overdue invoice";
        const summaryParts = [
          label,
          balanceCents > 0 ? `${fmtMoneyCents(balanceCents)} outstanding` : null,
          typeof daysOverdue === "number" && daysOverdue > 0 ? `${daysOverdue}d overdue` : null,
        ].filter(Boolean);
        const summary = summaryParts.join(" · ");

        const expectation = "Invoices should be paid on time to protect cash flow and avoid collections work.";
        const observation =
          dueDate
            ? `${label} is past due (due ${formatDateShort(dueDate)}).`
            : `${label} is past due in QuickBooks.`;

        const drift =
          "Overdue invoices often become harder to collect as they age, and can signal broader customer risk.";

        const nextStep =
          "Confirm the invoice was delivered and correct, then send a reminder or follow up directly. Start with the largest balances.";

        const score = scoreQboOverdueInvoice(ctx);

        return {
          domainLabel,
          title,
          summary,
          expectation,
          observation,
          drift,
          nextStep,
          confidenceLabel,
          score,
        };
      }

      // Legacy aggregated shape (fallback)
      const invoices: any[] = Array.isArray(ctx.invoices) ? ctx.invoices : [];
      const count = invoices.length;

      let totalBalanceCents = 0;
      let maxDaysOverdue: number | null = null;
      const now = new Date();

      for (const inv0 of invoices) {
        const bal = Number(inv0?.balanceCents ?? 0);
        if (bal > 0) totalBalanceCents += bal;

        const due = typeof inv0?.dueDate === "string" ? new Date(inv0.dueDate) : null;
        if (due && !isNaN(due.getTime())) {
          const d = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
          if (maxDaysOverdue == null || d > maxDaysOverdue) maxDaysOverdue = d;
        }
      }

      const title = "Overdue invoices";
      const summaryParts = [
        `${count} invoice${count === 1 ? "" : "s"}`,
        totalBalanceCents > 0 ? `${fmtMoneyCents(totalBalanceCents)} outstanding` : null,
        typeof maxDaysOverdue === "number" && maxDaysOverdue > 0 ? `${maxDaysOverdue}d overdue (max)` : null,
      ].filter(Boolean);
      const summary = summaryParts.join(" · ");

      const expectation = "Invoices should be paid on time to protect cash flow and avoid collections work.";
      const observation =
        count > 0
          ? `There ${count === 1 ? "is" : "are"} ${count} unpaid invoice${count === 1 ? "" : "s"} past due in QuickBooks.`
          : "No overdue invoices detected.";

      const drift =
        "Overdue invoices often become harder to collect as they age, and can signal broader customer risk.";

      const nextStep =
        "Review the largest balances first. Confirm the invoice was delivered and correct, then send a reminder or follow up directly.";

      const score = scoreQboOverdueInvoice(ctx);

      return {
        domainLabel,
        title,
        summary,
        expectation,
        observation,
        drift,
        nextStep,
        confidenceLabel,
        score,
      };
    }

    // --- everything below unchanged ---
    case "missed_expected_payment": {
      const domainLabel = "Revenue";

      const expectation = exp
        ? `We expect ${name} to pay ${fmtMoneyCents(exp.amount_cents)} (${exp.cadence}).`
        : `We expect ${name} to pay on a schedule.`;

      const invPart =
        inv?.stripe_invoice_id
          ? `Latest invoice ${inv.status || "—"} (${formatDateShort(inv.invoice_date)}), ${inv.paid_at ? "paid" : "unpaid"}.`
          : "No invoice context available.";

      const payPart = pay?.paid_at ? `Last payment received ${formatDateShort(pay.paid_at)}.` : "No recent payment recorded.";
      const observation = `${payPart} ${invPart}`;

      const overdueText =
        params.overdueDays != null && params.overdueDays > 0 ? `...Overdue by ${params.overdueDays} days.` : `Deviation detected.`;
      const amtText = amountAtRisk ? `${fmtMoneyCents(amountAtRisk)} at risk.` : "Amount at risk unknown.";
      const drift = `${overdueText} ${amtText}`;

      const title = "Payment expected but not received";

      const expectedForSummary = a.expected_amount_cents != null ? a.expected_amount_cents : amountAtRisk || null;
      const summaryParts = [
        expectedForSummary ? `${fmtMoneyCents(expectedForSummary)} expected` : null,
        params.overdueDays != null ? `${params.overdueDays} days overdue` : null,
      ].filter(Boolean);

      const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : a.message || "Deviation from expectation detected.";

      const nextStep = [
        "Confirm whether payment was attempted or received outside the normal path.",
        "If unpaid: send reminder and confirm the customer is still active on this cadence.",
        "If this expectation is no longer valid: update the expectation so it stops surfacing.",
      ].join(" ");

      const score = scoreFromRegistry({
        alert: a,
        severity: params.severity || "medium",
        overdueDays: params.overdueDays,
      });

      return {
        domainLabel,
        title,
        summary,
        expectation,
        observation,
        drift,
        nextStep,
        confidenceLabel,
        score,
      };
    }

    default: {
      const domainLabel = "Ops";

      const title = a.message || "Alert";
      const summary = a.message || "Alert";

      const expectation = "System expectations should remain stable.";
      const observation = "A deviation was detected.";
      const drift = "This may indicate something needs attention.";
      const nextStep = "Review and take action if needed.";

      const score = scoreFromRegistry({
        alert: a,
        severity: params.severity || "medium",
        overdueDays: params.overdueDays,
      });

      return {
        domainLabel,
        title,
        summary,
        expectation,
        observation,
        drift,
        nextStep,
        confidenceLabel,
        score,
      };
    }
  }
}
