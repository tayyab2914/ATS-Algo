/**
 * Shared types for the dashboard chrome. The numbers themselves come from
 * `lib/dashboard/metrics.ts`, computed from the bot catalogue and from real
 * positions — nothing on this screen is illustrative any more.
 */
export type MetricIconKey =
  | "bot"
  | "target"
  | "barChart"
  | "percent"
  | "shield"
  | "layers"
  | "trendingUp"
  | "activity";
