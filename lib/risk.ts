/**
 * Single source of truth for how a bot's risk class is labelled, coloured and
 * ordered across the whole app, so the three colours never drift between the
 * admin bots table, the backtest read-out, the admin bot detail page and the
 * member-facing Bot Library.
 *
 * Colours: GREEN = Low, BLUE (accent) = Medium, RED = High.
 *
 * Two casings exist in the codebase — the admin/Prisma enum is upper-case
 * ("LOW"|"MEDIUM"|"HIGH") and the Bot Library model is title-case
 * ("Low"|"Medium"|"High"). Everything here keys on the upper-case canonical form
 * and {@link toRiskLevel} normalises either casing, so both worlds share it.
 *
 * Pure module — safe to import from server and client components.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/** Pill background + text classes, by risk. */
export const RISK_BADGE_CLASS: Record<RiskLevel, string> = {
  LOW: "bg-success/10 text-success",
  MEDIUM: "bg-accent/10 text-accent",
  HIGH: "bg-[#D2031E]/10 text-[#D2031E]",
};

/** Plain text colour (no background), for inline risk mentions. */
export const RISK_TEXT_CLASS: Record<RiskLevel, string> = {
  LOW: "text-success",
  MEDIUM: "text-accent",
  HIGH: "text-[#D2031E]",
};

/** Title-case display label. */
export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

/** Severity/sort order: Low (0) < Medium (1) < High (2). */
export const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/** Normalise any casing ("Low", "medium", "HIGH") to the canonical enum. */
export function toRiskLevel(value: string): RiskLevel {
  const u = value.toUpperCase();
  return u === "LOW" || u === "HIGH" ? u : "MEDIUM";
}

/** Pill classes for a risk value of either casing. */
export function riskBadgeClass(value: string): string {
  return RISK_BADGE_CLASS[toRiskLevel(value)];
}
