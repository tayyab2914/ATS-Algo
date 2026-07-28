// Guards the Portfolio PnL calendar's arithmetic. The properties that matter:
//
//   - A trade lands on the UTC+2 day it CLOSED, including either side of midnight.
//   - Weeks are Monday-first, and a week's total counts only the days inside the
//     month being shown — so the twelve monthly totals add up to the year exactly.
//   - Cumulative means "since the first trade", not "since the start of the view".
//   - Navigation can't wander off into months that could not contain data.
//
// Run: npx tsx scripts/verify-portfolio-calendar.ts
import {
  buildMonthView,
  buildYearView,
  calendarBounds,
  canStepMonth,
  canStepYear,
  computeDailyPnl,
  dayKey,
  returnPct,
  stepMonth,
  type CalendarTrade,
} from "../lib/portfolio/calendar.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const trade = (closedAt: string, realizedPnl: number, marginUsed = 100): CalendarTrade => ({
  realizedPnl,
  marginUsed,
  closedAt: new Date(closedAt),
});

console.log("\n1. A trade lands on the UTC+2 day it closed");
// 21:59 UTC on the 14th is 23:59 on the 14th in UTC+2; 22:00 UTC is already the 15th.
check("21:59Z on the 14th → the 14th", dayKey(new Date("2026-03-14T21:59:00Z")) === "2026-03-14");
check("22:00Z on the 14th → the 15th (UTC+2 midnight)", dayKey(new Date("2026-03-14T22:00:00Z")) === "2026-03-15");
check("00:30Z on the 15th → still the 15th", dayKey(new Date("2026-03-15T00:30:00Z")) === "2026-03-15");
check("no DST shift in summer", dayKey(new Date("2026-07-14T22:00:00Z")) === "2026-07-15");

console.log("\n2. Days bucket, sort, and total");
const days = computeDailyPnl([
  trade("2026-03-03T10:00:00Z", 120, 400),
  trade("2026-03-03T15:00:00Z", -20, 100),
  trade("2026-03-01T10:00:00Z", 50, 200),
  trade("2026-03-14T22:00:00Z", 75, 300), // → 15 March
]);
check("one row per trading day", days.length === 3, days.map((d) => d.date).join(", "));
check("ascending", days[0].date === "2026-03-01" && days[2].date === "2026-03-15");
check("same-day trades sum", near(days[1].pnl, 100) && days[1].trades === 2, JSON.stringify(days[1]));
check("margin sums too", near(days[1].margin, 500));
check("empty input → empty output", computeDailyPnl([]).length === 0);
check("return % is pnl over margin", near(returnPct({ ...days[1], tradingDays: 1 }) ?? 0, 20));
check("return % is null with no margin", returnPct({ pnl: 5, margin: 0, trades: 1, tradingDays: 1 }) === null);

console.log("\n3. Month grid: Monday-first, whole weeks, correct padding");
// 1 March 2026 is a Sunday, so the grid leads with six padding days.
const now = new Date("2026-03-20T12:00:00Z");
const march = buildMonthView(days, 2026, 2, now);
check("whole weeks only", march.weeks.every((w) => w.days.length === 7));
check("grid starts on a Monday", march.weeks[0].days[0].date === "2026-02-23", march.weeks[0].days[0].date);
check("1 March sits in the Sunday column", march.weeks[0].days[6].date === "2026-03-01");
check("31 days are marked in-month", march.weeks.flatMap((w) => w.days).filter((d) => d.inMonth).length === 31);
check("padding days are marked out-of-month", march.weeks[0].days[0].inMonth === false);
check("today is flagged once", march.weeks.flatMap((w) => w.days).filter((d) => d.isToday).length === 1);
check("tomorrow is flagged as future", march.weeks.flatMap((w) => w.days).find((d) => d.date === "2026-03-21")?.isFuture === true);
check("yesterday is not", march.weeks.flatMap((w) => w.days).find((d) => d.date === "2026-03-19")?.isFuture === false);
check("month total", near(march.totals.pnl, 225), String(march.totals.pnl));
check("trading days counted, not calendar days", march.totals.tradingDays === 3);
check("trades counted", march.totals.trades === 4);
check("best day", march.bestDay?.date === "2026-03-03" && near(march.bestDay.pnl, 100));
check("worst day", march.worstDay?.date === "2026-03-01" && near(march.worstDay.pnl, 50));
check("week totals sum to the month", near(march.weeks.reduce((s, w) => s + w.totals.pnl, 0), march.totals.pnl));

console.log("\n4. A week straddling a month boundary counts once, in the right month");
// 1 April 2026 is a Wednesday: its week starts 30 March. A trade on 30 March must
// count towards March's grid and NOT towards April's.
const straddle = computeDailyPnl([trade("2026-03-30T12:00:00Z", 40), trade("2026-04-01T12:00:00Z", 60)]);
const mar = buildMonthView(straddle, 2026, 2, now);
const apr = buildMonthView(straddle, 2026, 3, now);
check("March sees only the 30th", near(mar.totals.pnl, 40));
check("April sees only the 1st", near(apr.totals.pnl, 60));
const aprFirstWeek = apr.weeks[0];
check("April's first week shows 30 March as padding", aprFirstWeek.days[0].date === "2026-03-30" && !aprFirstWeek.days[0].inMonth);
check("…and does NOT count it", near(aprFirstWeek.totals.pnl, 60), String(aprFirstWeek.totals.pnl));
check("March's last week does NOT count 1 April", near(mar.weeks[mar.weeks.length - 1].totals.pnl, 40));
check("the two months still sum to both trades", near(mar.totals.pnl + apr.totals.pnl, 100));

console.log("\n5. Cumulative is since the first trade, not since the view opened");
const history = computeDailyPnl([
  trade("2025-11-10T12:00:00Z", 500),
  trade("2026-01-05T12:00:00Z", -200),
  trade("2026-03-03T12:00:00Z", 100),
]);
check("to end of Jan 2026 = 500 − 200", near(buildMonthView(history, 2026, 0, now).cumulative, 300));
check("to end of Feb 2026 carries January in", near(buildMonthView(history, 2026, 1, now).cumulative, 300));
check("to end of Mar 2026", near(buildMonthView(history, 2026, 2, now).cumulative, 400));
check("a month before any trade is zero", near(buildMonthView(history, 2025, 0, now).cumulative, 0));
check("year 2026 total excludes 2025", near(buildYearView(history, 2026, now).totals.pnl, -100));
check("year 2026 cumulative includes 2025", near(buildYearView(history, 2026, now).cumulative, 400));
check("year 2025 cumulative stops at its own end", near(buildYearView(history, 2025, now).cumulative, 500));

console.log("\n6. Year view: twelve cells, a running YTD, and the totals agree");
const year = buildYearView(history, 2026, now);
check("twelve months", year.months.length === 12);
check("January carries its own result", near(year.months[0].totals.pnl, -200));
check("YTD runs", near(year.months[0].cumulative, -200) && near(year.months[2].cumulative, -100));
check("YTD is flat through empty months", near(year.months[1].cumulative, -200));
check("December's YTD equals the year total", near(year.months[11].cumulative, year.totals.pnl));
check("monthly totals sum to the year", near(year.months.reduce((s, m) => s + m.totals.pnl, 0), year.totals.pnl));
check("month totals match the month view exactly", near(year.months[2].totals.pnl, buildMonthView(history, 2026, 2, now).totals.pnl));
check("best month", year.bestMonth?.month === 2);
check("worst month", year.worstMonth?.month === 0);
check("April 2026 is in the future relative to 20 March", year.months[3].isFuture === true);
check("March 2026 is not", year.months[2].isFuture === false);
check("a year with no trades has no best/worst", buildYearView(history, 2024, now).bestMonth === null);

console.log("\n7. Navigation stays inside the range data can exist in");
const bounds = calendarBounds(history, now);
check("first = the first trade's month (Nov 2025)", bounds.first.year === 2025 && bounds.first.month === 10);
check("last = the current month (Mar 2026)", bounds.last.year === 2026 && bounds.last.month === 2);
check("cannot step past the current month", canStepMonth(bounds.last, 1, bounds) === false);
check("can step back from it", canStepMonth(bounds.last, -1, bounds) === true);
check("cannot step before the first trade", canStepMonth(bounds.first, -1, bounds) === false);
check("stepping back from January lands in December", JSON.stringify(stepMonth({ year: 2026, month: 0 }, -1, bounds)) === JSON.stringify({ year: 2025, month: 11 }));
check("stepping forward is clamped, never wrapped", JSON.stringify(stepMonth(bounds.last, 5, bounds)) === JSON.stringify(bounds.last));
check("years are bounded the same way", canStepYear(2026, 1, bounds) === false && canStepYear(2026, -1, bounds) === true);
const empty = calendarBounds([], now);
check("a never-traded account still gets a valid range", empty.first.year === 2026 && empty.first.month === 2 && canStepMonth(empty.first, -1, empty) === false);
check("…and renders a grid rather than throwing", buildMonthView([], 2026, 2, now).weeks.length > 0);

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
