// Smoke-test the shipped backtest engine against the fixtures.
// Run: node --experimental-strip-types scripts/verify-engine.ts
import { readFileSync } from "node:fs";
import { runBacktest, roundMetrics, type RiskKey } from "../lib/backtest/engine.ts";

const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8"));
const csv = readFileSync("fixtures/BTC.csv", "utf8");

const r = runBacktest(config, csv);
console.log(`candles ${r.candleCount} | window ${r.windowDays}d`);
for (const k of ["safe", "balanced", "aggressive"] as RiskKey[]) {
  const m = roundMetrics(r.profiles[k]);
  console.log(`${k.padEnd(11)} trades ${String(m.trades).padStart(2)}  win ${m.winRate.toFixed(2)}%  PF ${m.profitFactor.toFixed(2)}  ret ${m.totalReturn.toFixed(2)}%  avg ${m.avgTrade.toFixed(2)}%`);
}
