// PnL attribution, proved as pure maths — no key, no exchange.
//
// The fills below are the REAL ones behind the +$2,669.12 incident, read back off Bitget:
// position cmukej7fq01kimoqjlx51aam9, a SHORT of 0.0213 BTC opened 2026-09-27 22:40 and
// closed by reversal 2026-09-29 00:00. Two things went wrong at once, and both are asserted
// here so neither can come back:
//
//   1. The closing fill had executed 4.4s before settle read the venue, and was not
//      published yet. A set missing a leg must be DEFERRED, never booked.
//   2. The old fallback then widened to every fill in the window — which on a reversal
//      contains the PREVIOUS position's closing sell, 8s before this one opened. A fill we
//      did not place must NEVER be counted, whatever else is missing.
//
// Run: NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-pnl-attribution-logic.ts
import { attribute } from "../lib/execution/manage.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) <= tol;

type TestFill = {
  order: string;
  side: "buy" | "sell";
  price: number;
  amount: number;
  fee: { cost: number };
  info: Record<string, string>;
};

const SIZE = 0.0213;
const OUR_ENTRY = "1488235073529085953";
const OUR_TPS = ["1488235076674813953", "1488235076674813956", "1488235076674813959"];
const OUR_CLOSE = "1488617584029499401";
/** The PREVIOUS position's reversal close, 8 seconds before this position opened. */
const FOREIGN = "1488235048199684097";

const fill = (order: string, side: "buy" | "sell", price: number, amount: number, fee: number, profit: string): TestFill => ({
  order,
  side,
  price,
  amount,
  fee: { cost: fee },
  info: { profit },
});

const foreign = fill(FOREIGN, "sell", 84171.5, 0.0197, 0.99490713, "3.09093");
const entry = fill(OUR_ENTRY, "sell", 84169.1, SIZE, 1.07568109, "0");
const tp0 = fill(OUR_TPS[0], "buy", 83478.9, 0.0017, 0.02838282, "1.17334");
const tp1 = fill(OUR_TPS[1], "buy", 82990.7, 0.0046, 0.07635144, "5.42064");
const tp2 = fill(OUR_TPS[2], "buy", 82569.9, 0.0031, 0.05119333, "4.95752");
const close = fill(OUR_CLOSE, "buy", 83454.9, 0.0119, 0.59586798, "8.49898");

const ours = new Set([OUR_ENTRY, ...OUR_TPS, OUR_CLOSE]);
const run = (fills: TestFill[], ourOrderIds = ours, positionSize = SIZE) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a fill fixture, not a ccxt Trade
  attribute({ trades: fills as any, ourOrderIds, exitSide: "buy", positionSize, contractSize: 1 });

console.log("── the whole trade, as the venue finally published it ──");
const whole = run([foreign, entry, tp0, tp1, tp2, close]);
check("both legs reconcile against the position size", whole.complete, `opened ${whole.openedAmount} closed ${whole.closedAmount} of ${SIZE}`);
check("books +$18.22, the figure Bitget actually paid", near(whole.pnl, 18.22), `$${whole.pnl.toFixed(2)}`);
check("the venue's own realized figure agrees", whole.venuePnl !== null && near(whole.venuePnl, whole.pnl), `$${whole.venuePnl?.toFixed(2)}`);
check("the foreign fill is not counted", whole.fills === 5, `${whole.fills} fills attributed`);
check("NOT the +$2,669.12 that was booked", !near(whole.pnl, 2669.12, 1));

console.log("\n── settle's view: the closing fill has not been published yet ──");
const racing = run([foreign, entry, tp0, tp1, tp2]);
check("the set is incomplete, so nothing is booked as final", !racing.complete, `closed ${racing.closedAmount} of ${SIZE}`);
check("the opening leg alone does not satisfy the check", !near(racing.closedAmount, SIZE));
check("the provisional figure is the venue's, short by the unseen fill", racing.venuePnl !== null && near(racing.venuePnl, 10.32), `$${racing.venuePnl?.toFixed(2)}`);
check("provisional is short by dollars, not by a notional", Math.abs((racing.venuePnl ?? 0) - 18.22) < 20);

console.log("\n── the fill we did not place is never adopted ──");
const withoutClose = run([foreign, entry, tp0, tp1, tp2], new Set([OUR_ENTRY, ...OUR_TPS]));
check("an unowned order id contributes nothing", withoutClose.fills === 4, `${withoutClose.fills} fills`);
check("it cannot complete the set either", !withoutClose.complete);
// The old code's widening produced exactly this. It must no longer be reachable.
const widened = run([foreign, entry, tp0, tp1, tp2], new Set([FOREIGN, OUR_ENTRY, ...OUR_TPS]));
check("only an explicit (wrong) ownership claim can reproduce +$2,669.12", near(widened.pnl, 2669.12, 0.01), `$${widened.pnl.toFixed(2)}`);
check("and even then it is reported incomplete, so it is not bookable", !widened.complete);

console.log("\n── a clean round trip in one fill each way ──");
const simple = run(
  [fill("open", "sell", 100, 1, 0.06, "0"), fill("shut", "buy", 90, 1, 0.054, "10")],
  new Set(["open", "shut"]),
  1,
);
check("complete", simple.complete);
check("+$10 gross, minus $0.114 of fees", near(simple.pnl, 9.886), `$${simple.pnl.toFixed(3)}`);
check("the venue's figure matches ours", near(simple.venuePnl ?? NaN, 9.886), `$${simple.venuePnl?.toFixed(3)}`);

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
