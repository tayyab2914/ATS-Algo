/**
 * Dashboard timeframe windows, anchored to UTC+2 as the spec requires.
 *
 * A fixed +02:00 offset, not a named zone: the platform reports on one clock
 * everywhere, so "today" means the same instant for every member regardless of
 * where they are. There is deliberately no daylight-saving handling — the spec
 * says "UTC+2 time base", and a shifting boundary would make yesterday's numbers
 * change overnight.
 *
 * Pure: no database, no clock of its own (pass `now` to test it).
 */

export const TIMEFRAMES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

/** Minutes east of UTC. */
const OFFSET_MINUTES = 120;
const OFFSET_MS = OFFSET_MINUTES * 60_000;

export const isTimeframe = (value: unknown): value is Timeframe =>
  typeof value === "string" && (TIMEFRAMES as readonly string[]).includes(value);

/** Anything unrecognised falls back to the spec's headline view. */
export const parseTimeframe = (value: unknown): Timeframe => (isTimeframe(value) ? value : "monthly");

/**
 * The instant the current `timeframe` bucket began, in UTC+2.
 *
 * Weeks start on Monday. Reads calendar fields off a shifted clock and shifts the
 * result back, which keeps the arithmetic free of the host machine's timezone.
 */
export function windowStart(timeframe: Timeframe, now: Date = new Date()): Date {
  const local = new Date(now.getTime() + OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const day = local.getUTCDate();

  let startLocal: number;
  switch (timeframe) {
    case "daily":
      startLocal = Date.UTC(year, month, day);
      break;
    case "weekly": {
      const mondayIndex = (local.getUTCDay() + 6) % 7; // Sunday(0) → 6
      startLocal = Date.UTC(year, month, day - mondayIndex);
      break;
    }
    case "monthly":
      startLocal = Date.UTC(year, month, 1);
      break;
    case "yearly":
      startLocal = Date.UTC(year, 0, 1);
      break;
  }
  return new Date(startLocal - OFFSET_MS);
}

/**
 * Trailing performance periods — the ONLY windows the catalogue can express.
 *
 * `Bot` publishes exactly four windowed returns: d30, d90, d180, d360. Everything
 * else on that table (winRate, profitFactor, trades) is a **lifetime** backtest
 * figure that does not move with a window at all.
 *
 * So the Performance Metrics selector offers these four, one per column. An
 * earlier version offered Daily/Weekly/Monthly/Yearly and mapped three of them
 * onto `d30`, which made three tabs render identical numbers.
 *
 * The calendar `Timeframe` above is a different thing, for a different control:
 * it windows *live* trading results, where "today" and "this week" are real.
 */
export const PERIODS = ["30d", "90d", "180d", "360d"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_DAYS: Record<Period, number> = { "30d": 30, "90d": 90, "180d": 180, "360d": 360 };
export const PERIOD_LABEL: Record<Period, string> = { "30d": "30D", "90d": "90D", "180d": "180D", "360d": "360D" };

export const isPeriod = (value: unknown): value is Period =>
  typeof value === "string" && (PERIODS as readonly string[]).includes(value);

export const parsePeriod = (value: unknown): Period => (isPeriod(value) ? value : "30d");

/** The `Bot` column holding this period's backtested return. */
export const periodColumn = (period: Period) => `d${PERIOD_DAYS[period]}` as "d30" | "d90" | "d180" | "d360";

/** Start of the trailing window, aligned to the UTC+2 day boundary. */
export function periodStart(period: Period, now: Date = new Date()): Date {
  const today = windowStart("daily", now);
  return new Date(today.getTime() - (PERIOD_DAYS[period] - 1) * 86_400_000);
}
