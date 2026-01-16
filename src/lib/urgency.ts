// src/lib/urgency.ts

/**
 * URGENCY / SEVERITY MODEL (single source of truth)
 *
 * We use:
 * - confidence: "high" | "medium" | "low" (human judgment: how likely this is a real issue)
 * - score: 0..100 (numeric urgency)
 * - severity: "critical" | "high" | "medium" | "low" (UI-friendly bucket derived from score)
 *
 * NOTE:
 * - The alert-specific scorers (e.g. Notion stale, QBO overdue) should produce a 0..100 score.
 * - The UI should NEVER implement its own score→severity thresholds.
 */

export type Confidence = "high" | "medium" | "low";
export type Severity = "critical" | "high" | "medium" | "low";

/**
 * Canonical score → severity thresholds.
 *
 * Keep these simple and stable. If you change them, update:
 * - this function
 * - SCORING.md (if present)
 */
export function scoreToSeverity(score: number): Severity {
  const s = clampScore(score);
  if (s >= 80) return "critical";
  if (s >= 60) return "high";
  if (s >= 40) return "medium";
  return "low";
}

export function clampScore(score: number): number {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function confidenceWeight(conf: Confidence | null | undefined): number {
  // Lightweight weighting used ONLY by generic score composition (not Notion/QBO scorers).
  // This is intentionally simple and easy to explain.
  if (conf === "high") return 30;
  if (conf === "medium") return 20;
  if (conf === "low") return 10;
  return 0;
}

export function severityLabel(sev: Severity): string {
  if (sev === "critical") return "Critical";
  if (sev === "high") return "High";
  if (sev === "medium") return "Medium";
  return "Low";
}
