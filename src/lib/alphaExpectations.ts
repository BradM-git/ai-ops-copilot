// src/lib/alphaExpectations.ts
// Alpha expectations — internal-only. Do not generalize/configure yet.
// These values define what "normal" means for With during Alpha.

export const ALPHA_EXPECTATIONS = {
  // NOTION / DELIVERY HEALTH
  notion: {
    // If an "active" project shows no activity for this many days -> alert
    staleProjectNoActivityDays: 5,

    // If a milestone/due date is overdue by this many days -> alert
    milestoneOverdueDays: 1,
  },

  // QUICKBOOKS / REVENUE HYGIENE
  quickbooks: {
    // If an invoice is overdue by this many days -> alert
    invoiceOverdueDays: 7,

    // Treat invoices >= this amount as "high risk" in copy/severity (optional usage)
    highRiskAmountCents: 10_000_00, // $10,000
  },
} as const;
