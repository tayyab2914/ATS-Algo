// Pure dashboard math: UTC+2 window boundaries, live aggregation, catalogue
// aggregation, and the monthly equity curve. No database, no exchange.
// Run: npx tsx scripts/verify-dashboard.ts
import { activeBotCount, aggregateCatalogue, aggregateLive, monthlyCurve } from "../lib/dashboard/metrics.ts";
import { PERIOD_DAYS, parsePeriod, parseTimeframe, periodColumn, periodStart, windowStart } from "../lib/dashboard/window.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const iso = (d: Date) => d.toISOString();
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

console.log("── UTC+2 window boundaries ──");
// 2026-07-10T00:30Z is 02:30 on the 10th in UTC+2 → today began at 22:00Z on the 9th.
const justAfterLocalMidnight = new Date("2026-07-10T00:30:00Z");
check("daily start is 22:00Z the previous day", iso(windowStart("daily", justAfterLocalMidnight)) === "2026-07-09T22:00:00.000Z", iso(windowStart("daily", justAfterLocalMidnight)));
// 2026-07-09T23:30Z is 01:30 on the 10th in UTC+2 — still the 10th, same boundary.
check("still the same UTC+2 day at 23:30Z", iso(windowStart("daily", new Date("2026-07-09T23:30:00Z"))) === "2026-07-09T22:00:00.000Z");
// 2026-07-09T21:30Z is 23:30 on the 9th in UTC+2 → previous day's boundary.
check("before the UTC+2 rollover it's yesterday", iso(windowStart("daily", new Date("2026-07-09T21:30:00Z"))) === "2026-07-08T22:00:00.000Z");

// 2026-07-10 is a Friday. The UTC+2 week began Monday 2026-07-06 → 2026-07-05T22:00Z.
check("weeks start Monday", iso(windowStart("weekly", justAfterLocalMidnight)) === "2026-07-05T22:00:00.000Z", iso(windowStart("weekly", justAfterLocalMidnight)));
// 2026-07-12 is a Sunday — it must belong to the week that began Monday the 6th.
check("Sunday belongs to the week that began Monday", iso(windowStart("weekly", new Date("2026-07-12T12:00:00Z"))) === "2026-07-05T22:00:00.000Z");
check("month starts on the 1st, UTC+2", iso(windowStart("monthly", justAfterLocalMidnight)) === "2026-06-30T22:00:00.000Z");
check("year starts Jan 1, UTC+2", iso(windowStart("yearly", justAfterLocalMidnight)) === "2025-12-31T22:00:00.000Z");

console.log("\n── parsing ──");
check("unknown timeframe falls back to monthly", parseTimeframe("nonsense") === "monthly" && parseTimeframe(undefined) === "monthly");
check("valid timeframe passes through", parseTimeframe("yearly") === "yearly");
check("unknown period falls back to 30d", parsePeriod("nonsense") === "30d" && parsePeriod(undefined) === "30d");
check("valid period passes through", parsePeriod("180d") === "180d");

console.log("\n── each period maps to its OWN catalogue column ──");
// The bug this guards: Daily/Weekly/Monthly all mapped onto `d30`, so three tabs
// rendered byte-identical numbers. Four periods, four columns, four answers.
const columns = (["30d", "90d", "180d", "360d"] as const).map(periodColumn);
check("30d→d30, 90d→d90, 180d→d180, 360d→d360", JSON.stringify(columns) === JSON.stringify(["d30", "d90", "d180", "d360"]), columns.join(","));
check("no two periods share a column", new Set(columns).size === 4);
check("period days match their labels", PERIOD_DAYS["90d"] === 90 && PERIOD_DAYS["360d"] === 360);

// Trailing windows, aligned to the UTC+2 day boundary.
const at = new Date("2026-07-10T12:00:00Z");
const todayStart = windowStart("daily", at);
check("30d starts 29 days before today's UTC+2 boundary", periodStart("30d", at).getTime() === todayStart.getTime() - 29 * 86_400_000);
check("a longer period starts earlier", periodStart("360d", at) < periodStart("30d", at));

console.log("\n── \"active\" means RUNNING, never PUBLISHED ──");
// The bug this guards: Bot.status === "ACTIVE" means the bot is PUBLISHED in the
// library — an admin toggle. UserBot.active === true means a member deployed it and
// switched it on. Counting the first told members 7 bots were active while zero
// were running, and My Bots said otherwise on the very next click.
check("no running deployments → 0, however many bots are published", activeBotCount([]) === 0);
check("counts distinct BOTS, not deployments", activeBotCount(["botA", "botA", "botB"]) === 2, "two members on botA is one running bot");
check("one running bot", activeBotCount(["botA"]) === 1);

console.log("\n── live aggregation ──");
const empty = aggregateLive([]);
check("no trades → all zero, no NaN", empty.trades === 0 && empty.winRate === 0 && empty.profitFactor === 0 && empty.avgReturnPct === 0);
const live = aggregateLive([
  { realizedPnl: 10, marginUsed: 100 },   // +10%
  { realizedPnl: -5, marginUsed: 100 },   // -5%
  { realizedPnl: 20, marginUsed: 200 },   // +10%
  { realizedPnl: -5, marginUsed: 100 },   // -5%
]);
check("trades / wins / losses", live.trades === 4 && live.wins === 2 && live.losses === 2);
check("win rate 50%", near(live.winRate, 50));
check("profit factor 30/10 = 3", near(live.profitFactor, 3));
check("realized = 20", near(live.realized, 20));
check("avg return on MARGIN, not notional", near(live.avgReturnPct, 2.5), `${live.avgReturnPct}%`);
// A zero-margin row can't express a return; it must not divide by zero.
const withZeroMargin = aggregateLive([{ realizedPnl: 10, marginUsed: 0 }, { realizedPnl: 10, marginUsed: 100 }]);
check("zero-margin rows are excluded from the return, not divided by", near(withZeroMargin.avgReturnPct, 10) && withZeroMargin.trades === 2);
const allWins = aggregateLive([{ realizedPnl: 5, marginUsed: 100 }]);
check("a bot that never lost has an infinite profit factor", allWins.profitFactor === Infinity);

console.log("\n── catalogue aggregation ──");
check("no bots → zeros, no NaN", aggregateCatalogue([], "d30").bots === 0 && aggregateCatalogue([], "d30").winRate === 0);
const bots = [
  { timeframe: "150m", trades: 900, winRate: 60, profitFactor: 1.5, d30: 4, d90: 12, d180: 20, d360: 40 },
  { timeframe: "150m", trades: 100, winRate: 90, profitFactor: 2.5, d30: 8, d90: 2, d180: 30, d360: 10 },
  { timeframe: "15m", trades: 500, winRate: 50, profitFactor: 0.9, d30: 1, d90: 30, d180: 5, d360: 90 },
];
const cat = aggregateCatalogue(bots, "d30");
check("total trades summed", cat.totalTrades === 1500);
// Trade-weighted: (60*900 + 90*100 + 50*500)/1500 = 58.667 — NOT the naive mean of 66.667.
// A 100-trade bot must not sway the platform win rate like a 900-trade one.
check("win rate is trade-weighted, not a naive mean", near(cat.winRate, 88_000 / 1500, 1e-9), `${cat.winRate.toFixed(3)} (naive would be 66.667)`);
check("avg d30 return", near(cat.avgReturn, (4 + 8 + 1) / 3));
check("best timeframe by mean return", cat.bestTimeframe === "150m", String(cat.bestTimeframe));
check("best timeframe follows the column", aggregateCatalogue(bots, "d360").bestTimeframe === "15m");
// Four columns must produce four genuinely different aggregates.
const perPeriod = (["d30", "d90", "d180", "d360"] as const).map((c) => aggregateCatalogue(bots, c).avgReturn);
check("every period yields a distinct average return", new Set(perPeriod).size === 4, perPeriod.map((v) => v.toFixed(2)).join(" | "));
// Lifetime figures must NOT move with the window; only the d-columns do.
const lifetimes = (["d30", "d90", "d180", "d360"] as const).map((c) => aggregateCatalogue(bots, c).winRate);
check("win rate is lifetime — identical across every period", new Set(lifetimes).size === 1, "must never look windowed");
// An unbeaten bot's Infinity would swallow the mean profit factor.
const withInfinite = aggregateCatalogue([...bots, { timeframe: "1h", trades: 10, winRate: 100, profitFactor: Infinity, d30: 1, d90: 1, d180: 1, d360: 1 }], "d30");
check("an infinite profit factor is excluded from the mean", Number.isFinite(withInfinite.profitFactor) && near(withInfinite.profitFactor, (1.5 + 2.5 + 0.9) / 3));

console.log("\n── monthly equity curve ──");
const now = new Date("2026-07-10T12:00:00Z");
const curveEmpty = monthlyCurve([], 8, now);
check("8 labels, ending in the current month", curveEmpty.labels.length === 8 && curveEmpty.labels[7] === "Jul", curveEmpty.labels.join(","));
check("no trades → a flat zero line, not a rising one", curveEmpty.curve.every((v) => v === 0));
const curve = monthlyCurve(
  [
    { closedAt: new Date("2026-06-15T00:00:00Z"), realizedPnl: 100 },
    { closedAt: new Date("2026-07-01T00:00:00Z"), realizedPnl: -40 },
    { closedAt: new Date("2026-07-05T00:00:00Z"), realizedPnl: 10 },
  ],
  8,
  now,
);
check("cumulative, not per-month", curve.curve[6] === 100 && curve.curve[7] === 70, curve.curve.join(","));
// History older than the window must not silently vanish, or the curve restarts at 0.
const carried = monthlyCurve([{ closedAt: new Date("2024-01-01T00:00:00Z"), realizedPnl: 500 }, { closedAt: new Date("2026-07-02T00:00:00Z"), realizedPnl: 25 }], 8, now);
check("older history is carried into the opening value", carried.curve[0] === 500 && carried.curve[7] === 525, carried.curve.join(","));

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
