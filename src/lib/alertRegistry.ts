// src/lib/alertRegistry.ts

export type Severity = "critical" | "high" | "medium";
export type AlertConfidence = "high" | "medium" | "low" | null;

export type AlertRow = {
  id: string;
  customer_id: string;
  type: string;
  message: string | null;
  amount_at_risk: number | null;
  status: string;
  created_at: string;

  source_system: string | null;
  primary_entity_type: string | null;
  primary_entity_id: string | null;

  confidence: AlertConfidence;
  confidence_reason: string | null;

  expected_amount_cents: number | null;
  observed_amount_cents: number | null;
  expected_at: string | null;
  observed_at: string | null;

  context: Record<string, any> | null;
};

export type CustomerRow = {
  id: string;
  account_id: string;
  stripe_customer_id: string | null;
  name: string | null;
  email: string | null;
  created_at: string;
};

export type ExpectedRevenueRow = {
  id: string;
  customer_id: string;
  cadence_days: number | null;
  expected_amount: number | null;
  last_paid_at: string | null;
  confidence: number | null; // float
  created_at: string;
};

export type InvoiceRow = {
  id: string;
  customer_id: string;
  stripe_invoice_id: string | null;
  amount_due: number | null;
  status: string | null;
  invoice_date: string | null;
  paid_at: string | null;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  customer_id: string;
  stripe_payment_intent_id: string | null;
  amount: number | null;
  paid_at: string | null;
  created_at: string;
};

export type AlertPresentation = {
  domainLabel: string; // source-agnostic domain name (Revenue, Delivery, etc.)
  title: string;
  summary: string;

  expectation: string;
  observation: string;
  drift: string;

  nextStep: string;

  confidenceLabel: string;
  score: number;
};

function fmtMoneyCents(n: number) {
  return (n / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatDateShort(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function confidenceLabelFromAlert(conf: AlertConfidence, reason: string | null): string {
  if (!conf) return "Confidence not set";
  const label = conf === "high" ? "High confidence" : conf === "medium" ? "Medium confidence" : "Low confidence";
  return reason ? `${label} — ${reason}` : label;
}

export function confidenceLabelFromFloat(conf: number | null): string {
  if (conf == null) return "Confidence not set";
  if (conf >= 0.8) return "High confidence";
  if (conf >= 0.5) return "Medium confidence";
  return "Low confidence";
}

function confidenceScore(conf: AlertConfidence, expectedFloat: number | null) {
  // prioritize alert.confidence if present; else use expected_revenue.confidence float
  if (conf === "high") return 30;
  if (conf === "medium") return 15;
  if (conf === "low") return 0;

  if (expectedFloat == null) return 0;
  if (expectedFloat >= 0.8) return 25;
  if (expectedFloat >= 0.5) return 12;
  return 0;
}

function impactScore(amountAtRiskCents: number) {
  // Log-ish scaling; avoids one whale dominating everything
  // 0..~80 typical
  const amt = Math.max(0, amountAtRiskCents);
  if (amt <= 0) return 0;
  const dollars = amt / 100;
  const score = Math.log10(dollars + 1) * 20; // e.g. $1000 => ~60
  return Math.round(score);
}

function overdueScore(overdueDays: number | null) {
  // Strong early ramp, then cap
  const d = Math.max(0, overdueDays ?? 0);
  return Math.min(80, d * 6); // 0..80
}

function recencyScore(createdAtISO: string) {
  const ageMs = Date.now() - new Date(createdAtISO).getTime();
  const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
  // Recent issues get a small bump; after 72h it fades to 0.
  return Math.max(0, Math.round(30 - ageHours * (30 / 72)));
}

export function scoreAlert(params: {
  severity: Severity;
  alert: AlertRow;
  overdueDays: number | null;
  expectedConfidenceFloat: number | null;
}): number {
  const sevBase = params.severity === "critical" ? 300 : params.severity === "high" ? 220 : 140;
  const amt = Number(params.alert.amount_at_risk ?? 0);

  return (
    sevBase +
    confidenceScore(params.alert.confidence, params.expectedConfidenceFloat) +
    impactScore(amt) +
    overdueScore(params.overdueDays) +
    recencyScore(params.alert.created_at)
  );
}

export function presentAlert(params: {
  alert: AlertRow;
  customer: CustomerRow | null;
  expected: ExpectedRevenueRow | null;
  latestInvoice: InvoiceRow | null;
  latestPayment: PaymentRow | null;
  overdueDays: number | null;
  severity: Severity;
}): AlertPresentation {
  const a = params.alert;
  const cust = params.customer;
  const exp = params.expected;
  const inv = params.latestInvoice;
  const pay = params.latestPayment;

  const name = cust?.name || cust?.email || "Customer";
  const amountAtRisk = Number(a.amount_at_risk ?? 0);

  const confidenceLabel = a.confidence
    ? confidenceLabelFromAlert(a.confidence, a.confidence_reason)
    : confidenceLabelFromFloat(exp?.confidence ?? null);

  // --- Source-agnostic “model copy”: Expectation / Observation / Drift / Next step ---
  // We keep a per-type registry here. Add new types by extending this switch.
  switch (a.type) {
    case "missed_expected_payment": {
      const domainLabel = "Revenue";

      // Expectation: prefer alert.expected_at + expected_amount_cents if set by generator
      let expectation = `${name} is expected to pay on a regular cadence.`;
      if (a.expected_at) {
        expectation = `${name} is expected to pay by ${formatDateShort(a.expected_at)}.`;
        if (a.expected_amount_cents != null) expectation += ` Expected amount ${fmtMoneyCents(a.expected_amount_cents)}.`;
      } else {
        const cadence = exp?.cadence_days ?? null;
        const lastPaid = exp?.last_paid_at ?? pay?.paid_at ?? null;
        if (cadence && lastPaid) {
          const expectedBy = addDays(lastPaid, cadence);
          expectation = `${name} typically pays every ${cadence} days. Next payment expected by ${formatDateShort(expectedBy)}.`;
        } else if (cadence) {
          expectation = `${name} is expected to pay on a ~${cadence}-day cadence.`;
        }
      }

      // Observation
      const invPart =
        inv?.stripe_invoice_id
          ? `Latest invoice ${inv.status || "—"} (${formatDateShort(inv.invoice_date)}), ${inv.paid_at ? "paid" : "unpaid"}.`
          : "No invoice context available.";

      const payPart = pay?.paid_at ? `Last payment received ${formatDateShort(pay.paid_at)}.` : "No recent payment recorded.";
      const observation = `${payPart} ${invPart}`;

      // Drift
      const overdueText =
        params.overdueDays != null && params.overdueDays > 0 ? `Overdue by ${params.overdueDays} days.` : `Deviation detected.`;
      const amtText = amountAtRisk ? `${fmtMoneyCents(amountAtRisk)} at risk.` : "Amount at risk unknown.";
      const drift = `${overdueText} ${amtText}`;

      // Title + summary (tight, deterministic)
      const title = "Payment expected but not received";
      const expectedForSummary = a.expected_amount_cents != null ? a.expected_amount_cents : amountAtRisk || null;

      const summaryParts = [
        expectedForSummary ? `${fmtMoneyCents(expectedForSummary)} expected` : null,
        params.overdueDays != null ? `${params.overdueDays} days overdue` : null,
      ].filter(Boolean);

      const summary =
        summaryParts.length > 0 ? summaryParts.join(" · ") : a.message || "Deviation from expectation detected.";

      // Next step: source-agnostic wording but actionable
      const nextStep =
        [
          "Confirm whether payment was attempted or received outside the normal path.",
          "If unpaid: send reminder and confirm the customer is still active on this cadence.",
          "If paused/churned: update the expectation so it stops surfacing.",
        ].join(" ");

      const score = scoreAlert({
        severity: params.severity,
        alert: a,
        overdueDays: params.overdueDays,
        expectedConfidenceFloat: exp?.confidence ?? null,
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

    // ✅ NEW SIGNAL: Payment Amount Drift
    case "payment_amount_drift": {
      const domainLabel = "Revenue";

      const expectedCents = a.expected_amount_cents;
      const observedCents = a.observed_amount_cents;

      const expectedStr = expectedCents != null ? fmtMoneyCents(expectedCents) : "—";
      const observedStr = observedCents != null ? fmtMoneyCents(observedCents) : "—";

      const title = "Payment amount drift";

      const summary =
        expectedCents != null && observedCents != null
          ? `${observedStr} observed · ~${expectedStr} expected`
          : a.message || "Payment amount deviates from historical norm.";

      // Expectation
      const expectation = `${name} typically pays around ${expectedStr} per payment.`;

      // Observation: anchor on observed_at if present
      const obsDate = a.observed_at ? formatDateShort(a.observed_at) : pay?.paid_at ? formatDateShort(pay.paid_at) : "—";
      const observation = `Most recent payment on ${obsDate} was ${observedStr}.`;

      // Drift: delta + % if possible
      let drift = amountAtRisk ? `${fmtMoneyCents(amountAtRisk)} deviation from expected.` : "Deviation detected.";
      if (expectedCents != null && observedCents != null && expectedCents > 0) {
        const pct = Math.round((Math.abs(observedCents - expectedCents) / expectedCents) * 100);
        const delta = Math.abs(observedCents - expectedCents);
        drift = `${fmtMoneyCents(delta)} deviation (${pct}%) from expected.`;
      }

      const nextStep =
        [
          "Open the latest Stripe payment and confirm what it should map to (invoice / subscription / milestone).",
          "If the new amount is correct: update the expectation baseline so drift clears.",
          "If incorrect: fix invoice/subscription pricing or follow up for the difference.",
        ].join(" ");

      const score = scoreAlert({
        severity: params.severity,
        alert: a,
        overdueDays: params.overdueDays, // usually null/0 for this signal, but harmless
        expectedConfidenceFloat: exp?.confidence ?? null,
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

    // ✅ NEW SIGNAL: No Recent Client Activity (Jira-backed)
    case "no_recent_client_activity": {
      const domainLabel = "Delivery";

      const lookbackFromContext = a.context?.lookback;
      const lookback = typeof lookbackFromContext === "string" && lookbackFromContext.trim() ? lookbackFromContext : "7d";

      const title = "No recent client activity";
      const summary = `No visible work progress in the past ${lookback}.`;

      const expectation = "This client should show some visible work progress each week.";
      const observation = `No meaningful activity has been recorded recently (last ${lookback}).`;
      const drift = "When client work goes quiet, it often precedes delivery risk or escalation.";

      const nextStep =
        "Open the client’s Jira board and confirm whether work is progressing elsewhere. If stalled, unblock or reset expectations.";

      const score = scoreAlert({
        severity: params.severity,
        alert: a,
        overdueDays: null,
        expectedConfidenceFloat: null,
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
      const domainLabel = "General";
      const title = "Deviation detected";
      const summary = a.message || "Deviation from expectation detected.";

      const expectation = "Expected behavior not specified.";
      const observation = "Observed behavior not specified.";
      const drift = amountAtRisk ? `${fmtMoneyCents(amountAtRisk)} at risk.` : "Deviation detected.";
      const nextStep = "Open the source of truth, confirm deviation, then either intervene or close as not an issue.";

      const score = scoreAlert({
        severity: params.severity,
        alert: a,
        overdueDays: params.overdueDays,
        expectedConfidenceFloat: exp?.confidence ?? null,
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
