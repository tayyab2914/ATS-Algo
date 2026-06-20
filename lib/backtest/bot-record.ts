/**
 * Shared bridge between the backtest engine and the `Bot` table. Both the
 * create (POST) and update (PATCH) routes run the backtest the same way, so the
 * persisted metric columns and `results` blob never drift between them.
 */
import { RISK_TO_PROFILE, roundMetrics, runBacktest, type BotConfig, type RiskClass } from "./engine";

/** Run the backtest and shape its output into the columns the `Bot` row stores. */
export function backtestBotColumns(config: BotConfig, csvText: string, riskClass: RiskClass) {
  const result = runBacktest(config, csvText);
  const headline = roundMetrics(result.profiles[RISK_TO_PROFILE[riskClass]]);
  const profiles = Object.fromEntries(
    Object.entries(result.profiles).map(([k, v]) => [k, roundMetrics(v)]),
  );

  return {
    trades: headline.trades,
    winRate: headline.winRate,
    profitFactor: Number.isFinite(headline.profitFactor) ? headline.profitFactor : 0,
    totalReturn: headline.totalReturn,
    avgTrade: headline.avgTrade,
    d30: headline.d30,
    d90: headline.d90,
    d180: headline.d180,
    d360: headline.d360,
    results: { windowDays: result.windowDays, candleCount: result.candleCount, profiles },
  };
}
