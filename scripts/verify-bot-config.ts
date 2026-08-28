// Guards the bot-config validator: the real fixture must pass, every malformed
// ladder that could reach the live executor must be rejected, and — the rule
// this file exists to pin — a bot need only carry the ONE profile its risk class
// trades, but that profile MUST be present.
// Run: npx tsx scripts/verify-bot-config.ts
import { readFileSync } from "node:fs";
import type { RiskClass } from "../lib/bot-config.ts";
import { botConfigError } from "../lib/validation.ts";

const good = JSON.parse(readFileSync("fixtures/BTC.json", "utf8"));
// A single-profile, no-fees config the generator emits mid-pipeline — kept as a
// fixture so this suite is self-contained (the source `TEST SIM/` tree is local-only).
const stale = JSON.parse(readFileSync("fixtures/stale-single-profile.json", "utf8"));
// The Bot Sim's FINISHED output, exactly as the client ships it: one `safe` profile,
// no `fees` block (those costs are inside the numbers), `ATR_value` / `reference_sl` /
// `picked_sl` provenance, and weights rounded to two decimals — which is why it sums
// to 1.01. It must upload as-is; that is the whole point of the file.
const official = JSON.parse(readFileSync("fixtures/bot-sim-official.json", "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (o: any) => JSON.parse(JSON.stringify(o));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mutate = (fn: (c: any) => void) => {
  const c = clone(good);
  fn(c);
  return c;
};
// The real single-profile shape an admin can upload: `profiles` wrapper, one key.
const oneProfile = { ...clone(good), profiles: { balanced: clone(good).profiles.balanced } };

/** [label, config, riskClass | undefined, shouldPass] */
const cases: [string, unknown, RiskClass | undefined, boolean][] = [
  ["fixtures/BTC.json (the real config)", good, undefined, true],
  ["fixtures/BTC.json at every risk class", good, "HIGH", true],
  ["the official Bot Sim file, uploaded as shipped", official, undefined, true],
  ["the official Bot Sim file on a LOW bot (its only profile)", official, "LOW", true],
  ["the official Bot Sim file on a HIGH bot → no aggressive profile", official, "HIGH", false],
  ["be = null means never", mutate((c) => (c.profiles.safe.be = null)), undefined, true],
  ["be = 0 means never", mutate((c) => (c.profiles.safe.be = 0)), undefined, true],

  // One bot trades one profile — the one its risk class selects.
  ["single balanced profile, MEDIUM bot", oneProfile, "MEDIUM", true],
  ["single balanced profile, no risk given", oneProfile, undefined, true],
  ["missing aggressive, no risk given → ok", mutate((c) => delete c.profiles.aggressive), undefined, true],
  ["missing aggressive, MEDIUM bot (uses balanced) → ok", mutate((c) => delete c.profiles.aggressive), "MEDIUM", true],
  ["missing aggressive, HIGH bot needs it → rejected", mutate((c) => delete c.profiles.aggressive), "HIGH", false],
  ["single balanced profile, HIGH bot → rejected", oneProfile, "HIGH", false],

  // `fees` USED TO BE the thing that told a finished config from a half-built one,
  // and these two cases pinned that. It no longer can: the official Bot Sim output
  // ships WITHOUT a fees block, because those costs are baked into the take-profit
  // distances it emits. A config with no fees is now a normal config, and there is
  // nothing structural left that distinguishes the generator's intermediate file —
  // so it is accepted, and the ladder rules below carry the whole weight.
  ["single-profile config with no fees block (the official Bot Sim shape)", stale, undefined, true],
  ["fees omitted → valid; the costs are already inside the numbers", mutate((c) => delete c.fees), undefined, true],
  ["fees present but malformed is still rejected", mutate((c) => (c.fees = { maker_fee_pct: -1, taker_fee_pct: 0 })), undefined, false],
  ["null", null, undefined, false],
  ["not an object", "nope", undefined, false],
  ["no profiles object at all", mutate((c) => delete c.profiles), undefined, false],
  ["empty profiles object", mutate((c) => (c.profiles = {})), undefined, false],
  ["tp/w length mismatch", mutate((c) => c.profiles.balanced.w.pop()), undefined, false],
  ["weights sum to 0.9 (rungs left uncovered)", mutate((c) => (c.profiles.safe.w = [0.1, 0.1, 0.15, 0.2, 0.22, 0.13])), undefined, false],
  ["weights sum to 1.2 (would over-close)", mutate((c) => (c.profiles.safe.w = [0.3, 0.1, 0.15, 0.2, 0.22, 0.23])), undefined, false],
  // The Bot Sim rounds every weight to two decimals, so its own official file sums
  // to 1.01 on six rungs. That is rounding, not a wrong ladder, and rejecting it
  // turned the finished config away at upload — see `weightSumTolerance`.
  ["weights sum to 1.01 — the official file's 2-decimal rounding", mutate((c) => (c.profiles.safe.w = [0.08, 0.22, 0.19, 0.22, 0.22, 0.08])), undefined, true],
  ["weights sum to 0.98 — rounding the other way", mutate((c) => (c.profiles.safe.w = [0.08, 0.22, 0.19, 0.22, 0.22, 0.05])), undefined, true],
  ["weights sum to 1.05 — beyond what 6 rungs of rounding can explain", mutate((c) => (c.profiles.safe.w = [0.12, 0.22, 0.19, 0.22, 0.22, 0.08])), undefined, false],
  ["be beyond the rung count", mutate((c) => (c.profiles.aggressive.be = 9)), undefined, false],
  ["negative stop-loss", mutate((c) => (c.profiles.safe.sl = -4)), undefined, false],
  ["stop-loss of 100%", mutate((c) => (c.profiles.safe.sl = 100)), undefined, false],
  ["leverage 0", mutate((c) => (c.profiles.balanced.lev = 0)), undefined, false],
  ["a zero-distance tp rung", mutate((c) => (c.profiles.safe.tp[0] = 0)), undefined, false],
  ["a negative weight", mutate((c) => (c.profiles.safe.w[0] = -0.1)), undefined, false],
  // A malformed profile the bot won't trade is still a real error — the same JSON
  // could later be published at that tier.
  ["a malformed profile the bot won't trade", mutate((c) => (c.profiles.aggressive.w = [2])), "MEDIUM", false],

  // ── the progressive stop ladder ──────────────────────────────────────────
  // Its PRESENCE is the gate: a config without it keeps the legacy one-shot `be`.
  ["legacy: no sl_tighten_pct (today's configs) still valid", good, "MEDIUM", true],
  ["ladder: tighten 25 on 6 rungs is sound", mutate((c) => (c.profiles.balanced.sl_tighten_pct = 25)), "MEDIUM", true],
  ["ladder: slippage_pct is accepted per ticker", mutate((c) => { c.slippage_pct = 0.08; c.profiles.balanced.sl_tighten_pct = 25; }), "MEDIUM", true],
  // G2 — too aggressive: after 3 rungs it wants the stop 2% ABOVE entry, but price has
  // only reached 0.64%. The stop would sit beyond the market and protect nothing.
  ["G2: tighten 50 puts the stop past the level price reached → rejected", mutate((c) => (c.profiles.balanced.sl_tighten_pct = 50)), "MEDIUM", false],
  // G3 — too timid: the 6th rung closes the position, so the stop only matters to rung
  // 5, and by then it is still +2% (a losing stop). It never locks anything in.
  ["G3: tighten 10 never reaches profit before the last rung → rejected", mutate((c) => (c.profiles.balanced.sl_tighten_pct = 10)), "MEDIUM", false],
  ["ladder: a negative tighten is nonsense", mutate((c) => (c.profiles.balanced.sl_tighten_pct = -5)), "MEDIUM", false],
  ["ladder: tighten over 100 jumps past entry on rung 1", mutate((c) => (c.profiles.balanced.sl_tighten_pct = 150)), "MEDIUM", false],
  // The geometry is checked on every profile present, not just the traded one — the
  // same JSON could be published at another tier later.
  ["G2 is checked on a profile the bot doesn't trade", mutate((c) => (c.profiles.aggressive.sl_tighten_pct = 50)), "MEDIUM", false],
];

let failures = 0;
for (const [label, config, riskClass, shouldPass] of cases) {
  const error = botConfigError(config, riskClass);
  const pass = shouldPass ? error === null : error !== null;
  if (!pass) failures++;
  const risk = riskClass ? `[${riskClass}]` : "[—]";
  console.log(`  ${pass ? "✓" : "✗"} ${risk.padEnd(9)}${label.padEnd(44)} ${error ?? "accepted"}`);
}

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
