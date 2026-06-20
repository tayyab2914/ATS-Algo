// Smoke-test the shipped backtest engine against the fixtures and the reference
// scenario-table numbers from TEST SIM/runs/BTC/.../scenario_table_safe.csv.
// Run: node --experimental-strip-types scripts/verify-engine.ts
import { readFileSync } from "node:fs";
import { runBacktest, roundMetrics, type RiskKey } from "../lib/backtest/engine.ts";

// Validate against the full BTC export that has a published reference scenario
// table (fixtures/BTC.csv is just a small working sample and may change).
const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8"));
const csv = readFileSync("fixtures/BTC-calibration.csv", "utf8");

const r = runBacktest(config, csv);
console.log(`candles ${r.candleCount} | span ${r.windowDays}d\n`);
for (const k of ["safe", "balanced", "aggressive"] as RiskKey[]) {
  const m = roundMetrics(r.profiles[k]);
  console.log(
    `${k.padEnd(11)} trades ${String(m.trades).padStart(3)}  win ${m.winRate.toFixed(2)}%  PF ${m.profitFactor.toFixed(
      2,
    )}  ret ${m.totalReturn.toFixed(2)}%  avg ${m.avgTrade.toFixed(2)}%  | d30 ${m.d30.toFixed(2)} d90 ${m.d90.toFixed(
      2,
    )} d180 ${m.d180.toFixed(2)} d360 ${m.d360.toFixed(2)}`,
  );
}

// SAFE profile (tp/w from safe), SL=4 BE=1 LEV=4, all 151 trades.
//   trades 151 and GROSS winrate 86.75% match the reference scenario table
//   (TEST SIM/runs/BTC/2026-06-04/safe/scenario_table_safe.csv) exactly.
//   PF/ret are the engine's values with the break-even exit fee SKIPPED (an
//   intentional deviation to match the admin's existing app — the reference NET
//   row, which fees the BE exit, is PF 1.061 / ret -1.59). These act as a
//   regression guard on the rest of the pipeline.
const REF = { trades: 151, winRate: 86.75, pf: 1.09, ret: 3.67 };
const s = r.profiles.safe;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const checks: [string, boolean][] = [
  [`trades ${s.trades} == ${REF.trades}`, s.trades === REF.trades],
  [`winRate ${s.winRate.toFixed(2)} ≈ ${REF.winRate}`, near(s.winRate, REF.winRate, 0.5)],
  [`PF ${s.profitFactor.toFixed(3)} ≈ ${REF.pf}`, near(s.profitFactor, REF.pf, 0.02)],
  [`L4x ret ${s.totalReturn.toFixed(2)} ≈ ${REF.ret}`, near(s.totalReturn, REF.ret, 0.5)],
];
console.log("\n── calibration (safe, SL4/BE1/LEV4 — gross win-rate, net money, BE exit not fee'd) ──");
let allPass = true;
for (const [label, pass] of checks) {
  console.log(`  ${pass ? "✓" : "✗"} ${label}`);
  allPass = allPass && pass;
}
console.log(allPass ? "\nPASS" : "\nFAIL");
process.exit(allPass ? 0 : 1);
