// Pure logic behind the My Bots detail view: relative times, event descriptions,
// and the drawdown of a realized-PnL curve. No database, no exchange.
// Run: npx tsx scripts/verify-live-view.ts
import { describeEvent, maxDrawdown, relativeTime } from "../lib/my-bots/live-view.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

const now = new Date("2026-07-10T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

console.log("── relative time ──");
check("under a minute", relativeTime(ago(30_000), now) === "just now");
check("minutes", relativeTime(ago(3 * 60_000), now) === "3 min ago");
check("hours", relativeTime(ago(2 * 3600_000), now) === "2 h ago");
check("days", relativeTime(ago(5 * 86_400_000), now) === "5 d ago");
check("a future timestamp doesn't go negative", relativeTime(new Date(now.getTime() + 60_000), now) === "just now");

console.log("\n── event descriptions ──");
check(
  "opened",
  describeEvent("position.opened", { side: "LONG", symbol: "BTC/USDT:USDT", entryPrice: 64400, rungsPlaced: 6, sandbox: true }) ===
    "Opened LONG BTC/USDT:USDT at 64400 · 6 take-profits placed (paper)",
);
check("break-even", describeEvent("stop.movedToBreakEven", null) === "Stop moved to break-even");
check(
  "closed with profit",
  describeEvent("position.closed", { reason: "TP_FULL", realizedPnl: 12.3456 }) === "Closed — full take-profit ladder · +12.35 USDT",
);
check(
  "closed on exit with a loss",
  describeEvent("position.closed", { reason: "EXIT", realizedPnl: -0.0889 }) === "Closed on exit signal · -0.09 USDT",
);
check("live gate is explained, not hidden", describeEvent("fanout.skip.liveNotArmed", null) === "Signal skipped — live trading is not armed");
check(
  "a substituted instrument is surfaced loudly",
  describeEvent("symbol.substituted", { requested: "AAPL/USDT:USDT", traded: "BTC/USDT:USDT" }).includes("instead of AAPL/USDT:USDT"),
);
check("an order failure shows the member-facing message", describeEvent("position.failed", { userMessage: "Insufficient balance" }) === "Order failed — Insufficient balance");
// An event nobody wrote a description for is still information; don't swallow it.
check("unknown events fall back to their name", describeEvent("some.new.event", null) === "some.new.event");
check("a missing detail never throws", describeEvent("position.opened", null).startsWith("Opened position"));

console.log("\n── max drawdown of the realized-PnL curve ──");
check("no trades", maxDrawdown([]) === 0);
check("monotonic gains have no drawdown", maxDrawdown([1, 3, 7]) === 0);
check("peak 10 → trough 4 is 6", maxDrawdown([5, 10, 8, 4, 9]) === 6);
check("a curve that only loses", maxDrawdown([-1, -3, -6]) === 6);
check("recovers then falls deeper", maxDrawdown([10, 2, 12, 1]) === 11);

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
