// The progressive stop ladder, proved as pure maths — no key, no exchange.
//
// The stop tightens LINEARLY after each filled rung and may cross entry to lock
// profit. G2 is the soundness rule: the stop must stay `buffer` inside the profit
// level price has already reached. G3 is a conformance rule: the ladder must
// actually lock profit before the final rung closes the position.
// Run: npx tsx scripts/verify-stop-ratchet.ts
import { readFileSync } from "node:fs";
import {
  ladderPreview,
  minDistancePct,
  nthNearestTp,
  ratchetDistancePct,
  ratchetPct,
  snapshotProfile,
  stopBufferPct,
  stopPlan,
  type BotConfig,
  type ProfileConfig,
  type ProfileSnapshot,
  type StopSide,
} from "../lib/bot-config.ts";
import { slPrice } from "../lib/execution/pricing.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;

const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
const balanced = config.profiles.balanced; // tp [0.4,0.41,0.64,0.98,1.48,2.44], sl 4, lev 7
const aggressive = config.profiles.aggressive; // tp [0.5,0.45,…] — NON-monotonic

const snap = (p: ProfileConfig, tighten: number | null): ProfileSnapshot =>
  snapshotProfile(config, { ...p, sl_tighten_pct: tighten });

const plan = (s: ProfileSnapshot, side: StopSide, n: number, beFilled = false) =>
  stopPlan({ snapshot: s, side, rungsFilled: n, beRungFilled: beFilled });

console.log("── the buffer: a round trip out of a stop ──");
const buffer = stopBufferPct(0.035, 0.05); // fixtures/BTC.json taker fee + default slippage
check("2 × taker + slippage = 0.12%", near(buffer, 0.12), `${buffer}`);

console.log("\n── the linear ladder (sl 4, tighten 25) walks to entry, then past it ──");
const s25 = snap(balanced, 25);
const d = (n: number) => ratchetDistancePct(4, 25, n);
check("n=0 → 4% (the original stop)", near(d(0), 4));
check("n=2 → 2% below entry", near(d(2), 2));
check("n=4 → 0% — exactly break-even", near(d(4), 0));
check("n=5 → −1% — the stop is now ABOVE entry", near(d(5), -1));

console.log("\n── a negative distance really does price into profit (both sides) ──");
check("LONG: d=−1 puts the stop ABOVE entry", slPrice(100, -1, "LONG") > 100, `${slPrice(100, -1, "LONG")}`);
check("SHORT: d=−1 puts the stop BELOW entry", slPrice(100, -1, "SHORT") < 100, `${slPrice(100, -1, "SHORT")}`);
check("LONG: d=+4 is still a 4% loss stop", near(slPrice(100, 4, "LONG"), 96));
check("SHORT: d=+4 is still a 4% loss stop", near(slPrice(100, 4, "SHORT"), 104));

console.log("\n── nearest-by-PRICE, never by rung index (the ladder isn't ascending) ──");
check("aggressive tp[0]=0.5 but tp[1]=0.45 — rung 2 is NEARER", aggressive.tp[0] > aggressive.tp[1]);
check("the 1st nearest is 0.45, NOT tp[0]=0.5", near(nthNearestTp(aggressive.tp, 1)!, 0.45), `${nthNearestTp(aggressive.tp, 1)}`);
check("the 2nd nearest is 0.5", near(nthNearestTp(aggressive.tp, 2)!, 0.5));
check("out of range → null", nthNearestTp(aggressive.tp, 99) === null);

console.log("\n── G2: the stop must stay INSIDE the level price already reached ──");
// After 5 rungs, price has touched the 5th-nearest TP (1.48%). A stop may sit at
// most `buffer` inside it — any tighter and it is above the market: a wrong-side
// trigger Bitget silently re-files, or an exit that gives the gain back in fees.
const floor5 = minDistancePct(1.48, buffer, "LONG");
check("floor after 5 rungs ≈ −1.358%", near(floor5, -1.3582, 1e-3), `${floor5.toFixed(4)}`);
check("tighten 25 is SOUND at n=5 (−1 ≥ −1.358)", plan(s25, "LONG", 5).violatesGeometry === false);
check("…sound at every step, both sides", [1, 2, 3, 4, 5].every((n) => !plan(s25, "LONG", n).violatesGeometry && !plan(s25, "SHORT", n).violatesGeometry));

// tighten 50 overshoots: after 3 rungs it wants the stop 2% ABOVE entry, but price
// has only reached 0.64%. The stop would be above the market. Must be rejected.
const s50 = snap(balanced, 50);
check("tighten 50 VIOLATES G2 at n=3 (wants −2%, floor −0.52%)", plan(s50, "LONG", 3).violatesGeometry === true, `d=${plan(s50, "LONG", 3).distancePct}`);
check("…and the plan does NOT silently clamp it — it reports and the caller skips", near(plan(s50, "LONG", 3).distancePct, -2));

console.log("\n── G2 is what makes PnL rise with every rung (the owner's claim) ──");
const rows = ladderPreview({ ...balanced, sl_tighten_pct: 25 }, 0.035, 0.05);
// n runs 0…tp.length−1: n=0 is the original stop, n=5 is five fills. There is no
// row for the 6th fill — the weights sum to 1, so that rung closes the position and
// no stop can matter after it.
check("rows are n=0…5 (no row past the final rung — it closes the position)", rows.length === balanced.tp.length && rows[rows.length - 1].n === balanced.tp.length - 1, `rows=${rows.length}, maxN=${rows[rows.length - 1].n}`);
check("no row breaches G2", rows.every((r) => !r.violatesG2));
let rising = true;
for (let i = 1; i < rows.length; i++) if (rows[i].pnlPct <= rows[i - 1].pnlPct) rising = false;
check("PnL if stopped STRICTLY increases with each rung", rising, rows.map((r) => r.pnlPct.toFixed(2)).join(" → "));
check("the last row locks PROFIT (positive PnL, stop above entry)", rows[rows.length - 1].profitLocked && rows[rows.length - 1].pnlPct > 0, `pnl=${rows[rows.length - 1].pnlPct.toFixed(3)}%`);
// Hand-computed: banked 0.09·0.4 + 0.08·0.41 = 0.0688; 83% still open at d=2 → 0.0688 − 1.66
check("n=2 PnL matches the hand calc (−1.5912%)", near(rows[2].pnlPct, 0.0688 - 0.83 * 2, 1e-9), `${rows[2].pnlPct}`);

console.log("\n── G3: a ladder that never locks profit is dead config ──");
const g3 = (t: number) => ladderPreview({ ...balanced, sl_tighten_pct: t }, 0.035, 0.05).some((r) => r.distancePct <= -buffer);
check("tighten 25 locks profit before the last rung", g3(25) === true);
check("tighten 10 NEVER does — the position closes first", g3(10) === false, "d(5)=+2, still a losing stop");

console.log("\n── the gate: no sl_tighten_pct ⇒ today's behaviour, byte for byte ──");
const legacy = snap(balanced, null); // be = 2
check("ratchetPct is null → the ladder is OFF", ratchetPct(legacy) === null);
check("before the be-rung fills: the original fixed stop", (() => { const p = plan(legacy, "LONG", 3, false); return p.rule === "FIXED" && near(p.distancePct, 4) && p.step === 0; })());
check("when the be-RUNG fills: one shot, to the entry", (() => { const p = plan(legacy, "LONG", 1, true); return p.rule === "BE" && p.distancePct === 0 && p.step === 1; })());
check("a legacy config NEVER reports a geometry breach", [0, 1, 2, 3, 4, 5].every((n) => !plan(legacy, "LONG", n, true).violatesGeometry));
check("rung COUNT alone does not arm legacy BE — the be-RUNG must fill", plan(legacy, "LONG", 5, false).rule === "FIXED");

console.log("\n── the ratchet only ever tightens ──");
for (const side of ["LONG", "SHORT"] as StopSide[]) {
  for (const t of [20, 25, 50]) {
    const s = snap(balanced, t);
    let mono = true;
    for (let n = 1; n <= balanced.tp.length - 1; n++) {
      if (plan(s, side, n).distancePct > plan(s, side, n - 1).distancePct) mono = false;
    }
    check(`${side} tighten ${t}: distance is non-increasing in n`, mono);
  }
}

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
