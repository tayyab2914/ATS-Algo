// Unit checks for the pure live-execution math (no exchange, no network).
// Run: npx tsx scripts/verify-execute.ts
import { readFileSync } from "node:fs";
import { beRungIndex, profileFor, type BotConfig } from "../lib/bot-config.ts";
import type { MarketInterface } from "ccxt";
import { closingSide, ladderFloorSize, planLadder, rungSizes, sizeFromMargin, slPrice, tpPrice, tradeMargin } from "../lib/execution/pricing.ts";

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

console.log("\n── ladder floor: the minimum a member is actually told to fund ──");
// Bybit BTC/USDT:USDT as measured on the venue: 0.001 BTC minimum order, 5 USDT minimum
// notional, a 0.001 amount step, and one contract is one BTC.
const bybitBtc = {
  limits: { amount: { min: 0.001 }, cost: { min: 5 } },
  precision: { amount: 0.001, price: 0.1 },
  contractSize: 1,
} as unknown as MarketInterface;
// The venue's own rounding: `amountToPrecision` TRUNCATES, which is the whole point.
const step001 = (n: number) => Math.floor(n * 1e3 + 1e-9) / 1e3;
const tick01 = (n: number) => Math.round(n * 10) / 10;

// The live report, reproduced: $140 per trade on the balanced BTC profile (lev 7, smallest
// rung 8%), BTC around 77,142. Both bots sat at $0 volume for twelve days on this.
const PRICE = 77_142.4;
const rawSize = sizeFromMargin(140, balanced.lev, PRICE);
const sent = step001(rawSize);
check("$140 @ 7x truncates to 0.012 BTC", near(sent, 0.012, 1e-12), `raw=${rawSize.toFixed(6)} sent=${sent}`);
check("…whose 8% rung is under Bybit's 0.001 minimum", sent * 0.08 < 0.001, `rung=${(sent * 0.08).toFixed(5)}`);

let quotedSize = 0;
let quotedNotional = 0;
try {
  planLadder(PRICE, sent, balanced, "LONG", bybitBtc, step001, tick01);
  check("$140 is rejected before the entry is sent", false, "it was accepted");
} catch (error) {
  const raw = error instanceof Error ? error.message : String(error);
  const [tag, size, notional] = raw.split(":");
  check("$140 is rejected with LADDER_TOO_SMALL", tag === "LADDER_TOO_SMALL", raw);
  quotedSize = Number(size);
  quotedNotional = Number(notional);
}

// THE REGRESSION. The old message quoted the untruncated arithmetic — 0.0125 BTC, ~964.28
// USDT, $137.75 of margin at 7x. A member who funded exactly that was rejected a second time,
// because 0.0125 truncates straight back down to 0.012. The quote must be a reachable size.
check("quoted size is a whole step above, not the unreachable 0.0125", near(quotedSize, 0.013, 1e-9), `quoted=${quotedSize}`);
check("quoted size survives the venue's truncation", near(step001(quotedSize), quotedSize, 1e-12));
check("quoted notional is ~1002.86, not the old ~964.28", quotedNotional > 1000 && quotedNotional < 1005, `quoted=${quotedNotional}`);

// And the proof that closes the loop: fund exactly what the message now asks for, and the
// ladder places. This is the assertion the old code could not pass.
const fundedMargin = quotedNotional / balanced.lev;
const fundedSent = step001(sizeFromMargin(fundedMargin, balanced.lev, PRICE));
let placed = false;
try {
  const rungs = planLadder(PRICE, fundedSent, balanced, "LONG", bybitBtc, step001, tick01);
  placed = rungs.length === balanced.w.length && rungs.every((r) => r.size >= 0.001);
} catch {
  placed = false;
}
check(`funding exactly the quoted ${fundedMargin.toFixed(2)} now WORKS`, placed, `size=${fundedSent}`);
check("and $1 under it still does not", !(() => {
  const under = step001(sizeFromMargin(fundedMargin - 1, balanced.lev, PRICE));
  try { planLadder(PRICE, under, balanced, "LONG", bybitBtc, step001, tick01); return true; } catch { return false; }
})());

console.log("\n── ladderFloorSize ──");
for (const [name, p] of [["safe", safe], ["balanced", balanced], ["aggressive", aggressive]] as const) {
  const floor = ladderFloorSize(PRICE, p, "SHORT", bybitBtc, step001, tick01);
  const minW = Math.min(...p.w);
  check(`${name}: a floor is found`, floor !== null);
  if (floor === null) continue;
  check(`${name}: floor clears the arithmetic minimum ${(0.001 / minW).toFixed(5)}`, floor >= 0.001 / minW - 1e-12, `floor=${floor}`);
  check(`${name}: floor lands on the venue's step`, near(step001(floor), floor, 1e-12), `floor=${floor}`);
  check(`${name}: the floor itself places a full ladder`, planLadder(PRICE, floor, p, "SHORT", bybitBtc, step001, tick01).length === p.w.length);
  // One step BELOW the floor must fail, or the floor is not the floor.
  const below = step001(floor - 0.001);
  let belowFails = false;
  try { planLadder(PRICE, below, p, "SHORT", bybitBtc, step001, tick01); } catch { belowFails = true; }
  check(`${name}: one step below (${below}) is rejected`, belowFails);
  console.log(`      ${name}: min ${(((floor * PRICE) / p.lev)).toFixed(2)} per trade at ${p.lev}x`);
}

// A SHORT prices its rungs below entry, so it clears a minimum NOTIONAL least easily — the
// figure quoted to a member has to hold for the harder side.
const costBound = {
  limits: { amount: { min: 0 }, cost: { min: 5 } },
  precision: { amount: 0.001, price: 0.1 },
  contractSize: 1,
} as unknown as MarketInterface;
const shortFloor = ladderFloorSize(100, balanced, "SHORT", costBound, step001, tick01);
const longFloor = ladderFloorSize(100, balanced, "LONG", costBound, step001, tick01);
check("SHORT floor is never below the LONG floor", shortFloor !== null && longFloor !== null && shortFloor >= longFloor, `short=${shortFloor} long=${longFloor}`);

// `precision.amount` is a STEP only under ccxt's TICK_SIZE mode. A DECIMAL_PLACES venue puts
// a digit COUNT in the same field, and trusting a `3` as a 3-BTC step would quote a member an
// absurd minimum. The guard must reject it and fall back, never multiply by it.
const decimalPlacesVenue = {
  limits: { amount: { min: 0.001 }, cost: { min: 5 } },
  precision: { amount: 3, price: 1 },
  contractSize: 1,
} as unknown as MarketInterface;
const guarded = ladderFloorSize(PRICE, balanced, "SHORT", decimalPlacesVenue, step001, tick01);
check("a digit-count precision is not mistaken for a 3 BTC step", guarded === null || guarded < 1, `floor=${guarded}`);

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
