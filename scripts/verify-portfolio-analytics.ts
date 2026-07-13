// Proves the Portfolio metric math against synthetic closed trades — every table
// figure, the Trading Analysis split, and the time-bucketed stat series — so the
// page shows correct numbers the moment real trades exist (and honest zeros now).
// Run: npx tsx scripts/verify-portfolio-analytics.ts
import {
  computeAnalysis,
  computeMetrics,
  computeMonthlyPnl,
  computeStatSeries,
  EMPTY_METRICS,
  parseStatWindow,
  type ClosedTrade,
  type TradeForBucket,
} from "../lib/portfolio/analytics.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

const DAY = 86_400_000;
const t = (over: Partial<ClosedTrade>): ClosedTrade => ({
  side: "LONG",
  realizedPnl: 0,
  marginUsed: 100,
  size: 0.01,
  entryPrice: 60_000,
  openedAt: new Date("2026-09-01T00:00:00Z"),
  closedAt: new Date("2026-09-02T00:00:00Z"),
  ...over,
});

// A: +$100 on $200 margin = +50% ; B: -$40 on $100 = -40% ; C: +$20 on $100 = +20%
const A = t({ side: "LONG", realizedPnl: 100, marginUsed: 200, size: 0.1, openedAt: new Date("2026-09-01T00:00:00Z"), closedAt: new Date("2026-09-02T00:00:00Z") });
const B = t({ side: "SHORT", realizedPnl: -40, marginUsed: 100, size: 0.05, openedAt: new Date("2026-09-03T00:00:00Z"), closedAt: new Date("2026-09-03T02:00:00Z") });
const C = t({ side: "LONG", realizedPnl: 20, marginUsed: 100, size: 0.02, openedAt: new Date("2026-09-04T00:00:00Z"), closedAt: new Date("2026-09-04T12:00:00Z") });

console.log("── computeMetrics ──");
const m = computeMetrics([A, B, C], 1000);
check("total P/L = 80", near(m.plUsd, 80));
check("P/L % on margin = 80/400 = 20%", near(m.plPct, 20));
check("ROI on $1000 capital = 8%", near(m.roiPct, 8));
check("avg per-trade return = (50-40+20)/3 = 10%", near(m.avgPlPct, 10), `${m.avgPlPct}`);
check("max loss -40%, max gain +50%", near(m.maxLossPct, -40) && near(m.maxGainPct, 50));
check("volume = notional = 10,200", near(m.volume, 0.1 * 60000 + 0.05 * 60000 + 0.02 * 60000), `${m.volume}`);
check("trades 3, wins 2, losses 1", m.tradesTotal === 3 && m.tradesWins === 2 && m.tradesLosses === 1);
check("profit factor = 120/40 = 3", m.profitFactor !== null && near(m.profitFactor, 3));
check("profit/volume = 80/10200 %", near(m.profitOverVolumePct, (80 / 10200) * 100));
check("percent profitable = 66.667", near(m.percentProfitable, (2 / 3) * 100));
check("avg time in trade = (24h+2h+12h)/3", near(m.avgTimeInTradeMs, (DAY + 2 * 3600_000 + 12 * 3600_000) / 3), `${m.avgTimeInTradeMs}`);

console.log("\n── edge cases ──");
const empty = computeMetrics([], 1000);
check("no trades → EMPTY, hasData false", empty.hasData === false && empty.plUsd === 0 && empty.profitFactor === 0);
check("EMPTY_METRICS is the zero object", EMPTY_METRICS.tradesTotal === 0 && EMPTY_METRICS.hasData === false);
const allWins = computeMetrics([A, C], 1000);
check("no losing trades → profit factor null (∞)", allWins.profitFactor === null);
const zeroMargin = computeMetrics([t({ realizedPnl: 5, marginUsed: 0 })], 1000);
check("zero-margin trade doesn't divide by zero", Number.isFinite(zeroMargin.avgPlPct) && zeroMargin.avgPlPct === 0);

console.log("\n── computeAnalysis (all-time, by direction) ──");
const a = computeAnalysis([A, B, C]);
check("volume 10,200 · closed 3 · winning 2", near(a.volume, 10200) && a.closedOrders === 3 && a.winningClosed === 2);
check("win rate 66.667%", near(a.winRate, (2 / 3) * 100));
check("PnL long = 100+20 = 120", near(a.pnlLong, 120));
check("PnL short = -40", near(a.pnlShort, -40));
check("empty analysis → all zero, no NaN", (() => { const e = computeAnalysis([]); return e.closedOrders === 0 && e.winRate === 0; })());

console.log("\n── computeStatSeries (monthly buckets) ──");
const now = new Date("2026-09-15T12:00:00Z");
const pos: TradeForBucket[] = [
  { realizedPnl: 30, marginUsed: 100, openedAt: new Date("2026-07-05T00:00:00Z"), closedAt: new Date("2026-07-10T00:00:00Z"), status: "CLOSED" }, // Jul +30%
  { realizedPnl: -10, marginUsed: 100, openedAt: new Date("2026-09-02T00:00:00Z"), closedAt: new Date("2026-09-06T00:00:00Z"), status: "CLOSED" }, // Sep -10%
  { realizedPnl: 0, marginUsed: 0, openedAt: new Date("2026-09-14T00:00:00Z"), closedAt: null, status: "OPEN" }, // still open
];
const s = computeStatSeries(pos, "month", now);
check("8 monthly labels ending in Sep", s.labels.length === 8 && s.labels[7] === "Sep", s.labels.join(","));
const jul = s.labels.indexOf("Jul");
const sep = s.labels.indexOf("Sep");
check("Jul bucket P/L = +30%", near(s.plPct[jul], 30), `${s.plPct[jul]}`);
check("Sep bucket P/L = -10%", near(s.plPct[sep], -10), `${s.plPct[sep]}`);
check("months with no trades read 0", s.plPct.filter((_, i) => i !== jul && i !== sep).every((v) => v === 0));
check("cumulative P/L is a running sum", near(s.cumulativePct[7], 30 - 10), `${s.cumulativePct[7]}`);
check("open position counted in Sep bucket", s.openCounts[sep] >= 1);

console.log("\n── computeMonthlyPnl (cumulative $) ──");
const c2 = computeMonthlyPnl(pos, 8, now);
check("cumulative $ carries prior history forward", near(c2.curve[7], 30 - 10), `${c2.curve[7]}`);
check("curve is non-decreasing where only gains, then dips", c2.curve[jul] === 30 && c2.curve[7] === 20);

console.log("\n── parseStatWindow ──");
check("unknown → month", parseStatWindow("nope") === "month" && parseStatWindow(undefined) === "month");
check("valid passes through", parseStatWindow("week") === "week" && parseStatWindow("all") === "all");

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
