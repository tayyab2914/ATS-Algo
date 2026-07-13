// Unit checks for the pure live-execution math (no exchange, no network).
// Run: npx tsx scripts/verify-execute.ts
import { readFileSync } from "node:fs";
import { beRungIndex, profileFor, type BotConfig } from "../lib/bot-config.ts";
import { closingSide, rungSizes, sizeFromMargin, slPrice, tpPrice, tradeMargin } from "../lib/execution/pricing.ts";

const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
// Bitget BTC/USDT:USDT amount precision is 0.0001 (measured); price precision 0.1.
const roundAmount = (n: number) => Math.floor(n * 1e4) / 1e4;

console.log("── price levels (both sides) ──");
check("long  SL 4% below entry", near(slPrice(100, 4, "LONG"), 96));
check("short SL 4% above entry", near(slPrice(100, 4, "SHORT"), 104));
check("long  TP 2.5% above entry", near(tpPrice(100, 2.5, "LONG"), 102.5));
check("short TP 2.5% below entry", near(tpPrice(100, 2.5, "SHORT"), 97.5));
check("closing side of LONG is sell", closingSide("LONG") === "sell");
check("closing side of SHORT is buy", closingSide("SHORT") === "buy");

console.log("\n── break-even rung is an INDEX, not a fill count ──");
const safe = profileFor(config, "LOW")!;
const balanced = profileFor(config, "MEDIUM")!;
const aggressive = profileFor(config, "HIGH")!;
check(`safe be=${safe.be} -> rung index 0`, beRungIndex(safe) === 0);
check(`balanced be=${balanced.be} -> rung index 1`, beRungIndex(balanced) === 1);
check(`aggressive be=${aggressive.be} -> rung index 0`, beRungIndex(aggressive) === 0);
// The regression this guards: aggressive.tp = [0.5, 0.45, ...] is NOT ascending,
// so rung 1 (0.45%) fills BEFORE rung 0 (0.5%). A "count the fills" implementation
// would arm break-even on the first fill it saw -- the wrong rung.
check(
  "aggressive ladder is non-monotonic (rung 1 nearer than rung 0)",
  aggressive.tp[1] < aggressive.tp[0],
  `tp=[${aggressive.tp.join(", ")}]`,
);
check("be=0 / null disables break-even", beRungIndex({ ...safe, be: 0 }) === null && beRungIndex({ ...safe, be: null }) === null);
check("out-of-range be is rejected", beRungIndex({ ...safe, be: 99 }) === null);

console.log("\n── sizing ──");
check("FIXED ignores allocatedCapital", tradeMargin({ allocationType: "FIXED", capitalPerTrade: 50, allocatedCapital: 1000, realizedBalance: 0, compounding: false }) === 50);
check("PERCENTAGE takes 10% of 1000", tradeMargin({ allocationType: "PERCENTAGE", capitalPerTrade: 10, allocatedCapital: 1000, realizedBalance: 0, compounding: false }) === 100);
check("compounding grows the base", tradeMargin({ allocationType: "PERCENTAGE", capitalPerTrade: 10, allocatedCapital: 1000, realizedBalance: 200, compounding: true }) === 120);
check("compounding ignored when off", tradeMargin({ allocationType: "PERCENTAGE", capitalPerTrade: 10, allocatedCapital: 1000, realizedBalance: 200, compounding: false }) === 100);
check("base floored at 0 on deep loss", tradeMargin({ allocationType: "PERCENTAGE", capitalPerTrade: 10, allocatedCapital: 1000, realizedBalance: -5000, compounding: true }) === 0);
check("size = margin*lev/price", near(sizeFromMargin(100, 7, 50_000), 0.014));

console.log("\n── TP ladder split ──");
for (const [name, p] of [["safe", safe], ["balanced", balanced], ["aggressive", aggressive]] as const) {
  const sumW = p.w.reduce((s, x) => s + x, 0);
  const size = 0.014;
  const rungs = rungSizes(size, p.w, roundAmount);
  const total = rungs.reduce((s, x) => s + x, 0);
  check(`${name}: Σw ≈ 1`, near(sumW, 1, 1e-9), `Σw=${sumW.toFixed(6)}`);
  check(`${name}: ${rungs.length} rungs, Σrungs ≤ size`, rungs.length === p.w.length && total <= size + 1e-12, `Σ=${total} size=${size}`);
  check(`${name}: no negative rung`, rungs.every((r) => r >= 0), `[${rungs.join(", ")}]`);
  // Σw === 1, so the ladder must close the WHOLE position — no float noise may
  // strand a precision step. Regression: 0.014 - 0.0107 === 0.00329999999...
  check(`${name}: Σrungs === size (no stranded step)`, near(total, size, 1e-12), `Σ=${total}`);
}
// Σw < 1 means the residue deliberately rides to the stop/exit -- the last rung
// must NOT swell to absorb it.
const partial = rungSizes(1, [0.25, 0.25], roundAmount);
check("Σw=0.5 leaves half the position open", near(partial.reduce((s, x) => s + x, 0), 0.5), `[${partial.join(", ")}]`);
check("empty ladder -> no rungs", rungSizes(1, [], roundAmount).length === 0);

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
