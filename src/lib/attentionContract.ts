// src/lib/attentionContract.ts

export type AttentionConfidence = "high" | "medium" | "low";

export type AlertRow = {
  id: string;
  customer_id: string | null;
  type: string | null;
  message: string | null;

  amount_at_risk: number | null; // cents
  status: string | null;
  created_at: string | null;

  // NEW contract fields (added via SQL)
  source_system: string | null;
  primary_entity_type: string | null;
  primary_entity_id: string | null;

  confidence: AttentionConfidence | null;
  confidence_reason: string | null;

  expected_amount_cents: number | null;
  observed_amount_cents: number | null;
  expected_at: string | null;
  observed_at: string | null;

  context: Record<string, any> | null;
};

export type AttentionContract = {
  headline: string;
  why: string;
  confidenceLabel: string;
  action: string;
};

function safeNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatMoneyFromCents(cents: number, currency: string) {
  const dollars = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(dollars);
  } catch {
    return `${dollars.toFixed(2)} ${currency}`;
  }
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function humanizeAlertType(t: string) {
  switch (t) {
    case "missed_expected_payment":
      return "Likely missed expected payment";
    case "payment_amount_drift":
      return "Payment amount drift";
    case "expected_payment_not_received":
      return "Expected payment not received";
    case "underpaid_invoice":
      return "Underpaid invoice";
    case "payment_failed":
      return "Payment failed";
    default:
      return t.replaceAll("_", " ");
  }
}

function actionForType(t: string) {
  switch (t) {
    case "missed_expected_payment":
      return "Action: confirm expectation still valid → follow up / retry / update cadence";
    case "payment_amount_drift":
      return "Action: verify invoice/subscription amount → reconcile difference / update baseline";
    case "expected_payment_not_received":
      return "Action: verify invoice/charge in Stripe → follow up if still unpaid";
    case "underpaid_invoice":
      return "Action: reconcile payment vs invoice → request remaining amount / fix attribution";
    case "payment_failed":
      return "Action: retry payment method → request updated payment details";
    default:
      return "Action: open and verify expectation vs reality → intervene if confirmed";
  }
}

export function buildAttentionContractFromAlert(row: AlertRow): AttentionContract {
  const type = row.type ?? "unknown";
  const currency = "USD";

  const amountRiskCents = safeNum(row.amount_at_risk);
  const amountRiskStr = formatMoneyFromCents(amountRiskCents, currency);

  const expectedCents = row.expected_amount_cents != null ? safeNum(row.expected_amount_cents) : null;
  const observedCents = row.observed_amount_cents != null ? safeNum(row.observed_amount_cents) : null;

  const expectedStr = expectedCents != null ? formatMoneyFromCents(expectedCents, currency) : null;
  const observedStr = observedCents != null ? formatMoneyFromCents(observedCents, currency) : null;

  const expectedAt = toDate(row.expected_at);
  const observedAt = toDate(row.observed_at);

  const headline =
    expectedCents != null && observedCents != null && observedCents < expectedCents
      ? `${humanizeAlertType(type)} — short by ${formatMoneyFromCents(expectedCents - observedCents, currency)}`
      : `${humanizeAlertType(type)} — ${amountRiskStr} at risk`;

  const why =
    expectedStr && observedStr && expectedAt
      ? `Expected ${expectedStr} by ${formatDate(expectedAt)}; observed ${observedStr}${observedAt ? ` as of ${formatDate(observedAt)}` : ""}`
      : row.message
        ? row.message
        : `Deviation detected. Amount at risk: ${amountRiskStr}.`;

  const conf = row.confidence ?? "medium";
  const confReason = row.confidence_reason ?? "type-based signal; verify on open";
  const confidenceLabel = `${conf.toUpperCase()} — ${confReason}`;

  const action = actionForType(type);

  return { headline, why, confidenceLabel, action };
}

export function severityScoreFromAlert(row: AlertRow): number {
  const status = (row.status ?? "").toLowerCase();
  const isOpen = !(status === "closed" || status === "resolved");

  const conf = row.confidence ?? "medium";
  const confW = conf === "high" ? 30 : conf === "medium" ? 20 : 10;

  const openW = isOpen ? 1000 : 0;

  const amountCents = safeNum(row.amount_at_risk);
  const amountW = amountCents * 0.0001;

  return openW + confW + amountW;
}

export function isClosed(status: string | null) {
  const s = (status ?? "").toLowerCase();
  return s === "closed" || s === "resolved";
}
