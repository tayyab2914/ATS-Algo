// Leverage / PnL calculator arithmetic. Pure — no database, no network.
// Run: npx tsx scripts/verify-calculator.ts
import { calculate, liquidationPrice, positionSizeForRisk, type CalculatorInput } from "../lib/portfolio/calculator.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

const base: CalculatorInput = {
  side: "long", entryPrice: 100, exitPrice: 110, quantity: 10, leverage: 10, feePct: 0, maintenanceMarginPct: 0.5,
};

console.log("── position value and margin ──");
const r = calculate(base);
check("notional = entry × quantity", near(r.notional, 1000));
check("margin = notional / leverage", near(r.margin, 100));
check("gross PnL = 10 × 10", near(r.grossPnl, 100));
check("no fees when fee is 0", near(r.fees, 0) && near(r.netPnl, 100));

console.log("\n── leverage magnifies ROI, not the price move ──");
check("price moved +10%", near(r.priceMove, 10));
// The whole point of leverage: a 10% move on 10x is a 100% return on collateral.
check("ROI on margin is +100%", near(r.roi, 100), `${r.roi}%`);
const unlevered = calculate({ ...base, leverage: 1 });
check("at 1x, ROI equals the price move", near(unlevered.roi, unlevered.priceMove));

console.log("\n── shorts invert ──");
const short = calculate({ ...base, side: "short" });
check("a short loses when price rises", near(short.grossPnl, -100));
check("…and its price move reads negative", near(short.priceMove, -10));
const shortWin = calculate({ ...base, side: "short", exitPrice: 90 });
check("a short profits when price falls", near(shortWin.grossPnl, 100) && near(shortWin.roi, 100));

console.log("\n── fees are charged on BOTH sides of the round trip ──");
const withFees = calculate({ ...base, feePct: 0.1 });
// entry 100×10×0.1% = 1, exit 110×10×0.1% = 1.1 → 2.1 total.
check("entry + exit, each on its own value", near(withFees.fees, 2.1), `${withFees.fees}`);
check("net PnL is gross minus fees", near(withFees.netPnl, 97.9));
check("ROI uses net, not gross", near(withFees.roi, 97.9));

console.log("\n── liquidation ──");
// long: entry × (1 − 1/lev + mmr) = 100 × (1 − 0.1 + 0.005) = 90.5
check("long liquidation sits below entry", near(liquidationPrice("long", 100, 10, 0.5), 90.5), String(liquidationPrice("long", 100, 10, 0.5)));
check("short liquidation sits above entry", near(liquidationPrice("short", 100, 10, 0.5), 109.5));
check("higher leverage means a closer liquidation", liquidationPrice("long", 100, 20, 0.5) > liquidationPrice("long", 100, 10, 0.5));
check("1x can't liquidate above zero-ish", liquidationPrice("long", 100, 1, 0.5) <= 1);
check("distance is reported as a percentage", near(calculate({ ...base }).distanceToLiquidation, 9.5), `${r.distanceToLiquidation}%`);
check("garbage input doesn't produce NaN", liquidationPrice("long", 0, 10, 0.5) === 0 && liquidationPrice("long", 100, 0, 0.5) === 0);

console.log("\n── position size from risk ──");
// Risking 1% of 10,000 = $100. A $10 stop distance ⇒ 10 units.
check("risk / stop distance", near(positionSizeForRisk(10_000, 1, 100, 90), 10));
check("a tighter stop allows a larger position", positionSizeForRisk(10_000, 1, 100, 95) > positionSizeForRisk(10_000, 1, 100, 90));
check("direction of the stop doesn't matter", near(positionSizeForRisk(10_000, 1, 100, 110), positionSizeForRisk(10_000, 1, 100, 90)));
// Leverage decides collateral, never how much loss a stop-out costs.
check("a zero stop distance is refused, not divided by", positionSizeForRisk(10_000, 1, 100, 100) === 0);
check("zero balance yields nothing", positionSizeForRisk(0, 1, 100, 90) === 0);

console.log("\n── degenerate inputs ──");
const zero = calculate({ ...base, quantity: 0, leverage: 1 });
check("zero quantity → zero everything, no NaN", zero.notional === 0 && zero.margin === 0 && zero.roi === 0);
const zeroEntry = calculate({ ...base, entryPrice: 0 });
check("zero entry price → no division by zero", Number.isFinite(zeroEntry.priceMove) && Number.isFinite(zeroEntry.roi));

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
