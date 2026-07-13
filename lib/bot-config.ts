/**
 * The bot configuration an admin uploads, and the risk profile a deployment
 * trades with.
 *
 * Deliberately standalone — no imports, pure declarations — so the LIVE
 * execution path can read a bot's ladder without pulling in the backtest engine.
 * The platform never backtests at trade time: TradingView's Strategy Tester does
 * that, and the uploaded CSV is only parsed into stored metrics. Nothing under
 * `lib/execution/` may import from `lib/backtest/`.
 *
 * `lib/backtest/engine.ts` re-exports everything here, so existing importers are
 * unaffected.
 */

export type RiskKey = "safe" | "balanced" | "aggressive";
export type RiskClass = "LOW" | "MEDIUM" | "HIGH";

export const RISK_TO_PROFILE: Record<RiskClass, RiskKey> = {
  LOW: "safe",
  MEDIUM: "balanced",
  HIGH: "aggressive",
};

export const RISK_KEYS: RiskKey[] = ["safe", "balanced", "aggressive"];

export type ProfileConfig = {
  /**
   * Take-profit rung distances from entry, in percent. **Not necessarily
   * ascending** — a real config has `aggressive.tp = [0.5, 0.45, …]`, so rung 2
   * is nearer than rung 1 and fills first.
   */
  tp: number[];
  /** Fraction of the position closed at each rung; `w[k]` pairs with `tp[k]`. */
  w: number[];
  /** Stop-loss distance from entry, in percent. */
  sl: number;
  /**
   * 1-based **index** of the rung whose fill moves the stop to break-even
   * (null/0 = never). `be: 2` means "when `tp[1]` fills", NOT "once any two
   * rungs have filled" — since the ladder isn't always ascending, counting fills
   * would arm break-even off the wrong rung. See {@link beRungIndex}.
   */
  be: number | null;
  lev: number;
};

export type BotConfig = {
  name?: string;
  ticker?: string;
  type?: string;
  exchange?: string;
  timeframe?: string;
  optimized_period?: number;
  fees?: { maker_fee_pct?: number; taker_fee_pct?: number };
  profiles: Record<RiskKey, ProfileConfig>;
};

/** The single profile this bot trades, selected by its risk class. */
export function profileFor(config: BotConfig, riskClass: RiskClass): ProfileConfig | undefined {
  return config.profiles?.[RISK_TO_PROFILE[riskClass]];
}

/**
 * Index into `tp[]`/`w[]` of the rung whose fill arms break-even, or null when
 * the profile never moves its stop. Guards an out-of-range `be`.
 */
export function beRungIndex(profile: ProfileConfig): number | null {
  const be = profile.be;
  if (be == null || be <= 0 || be > profile.tp.length) return null;
  return be - 1;
}
