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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clone = (o: any) => JSON.parse(JSON.stringify(o));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mutate = (fn: (c: any) => void) => {
  const c = clone(good);
  fn(c);
  return c;
};
// The real single-profile shape an admin can upload: `profiles` wrapper, one key,
// plus the fees block the generator's raw strategy_profiles.json omits.
const oneProfile = { ...clone(good), profiles: { balanced: clone(good).profiles.balanced } };

/** [label, config, riskClass | undefined, shouldPass] */
const cases: [string, unknown, RiskClass | undefined, boolean][] = [
  ["fixtures/BTC.json (the real config)", good, undefined, true],
  ["fixtures/BTC.json at every risk class", good, "HIGH", true],
  ["be = null means never", mutate((c) => (c.profiles.safe.be = null)), undefined, true],
  ["be = 0 means never", mutate((c) => (c.profiles.safe.be = 0)), undefined, true],

  // One bot trades one profile — the one its risk class selects.
  ["single balanced profile, MEDIUM bot", oneProfile, "MEDIUM", true],
  ["single balanced profile, no risk given", oneProfile, undefined, true],
  ["missing aggressive, no risk given → ok", mutate((c) => delete c.profiles.aggressive), undefined, true],
  ["missing aggressive, MEDIUM bot (uses balanced) → ok", mutate((c) => delete c.profiles.aggressive), "MEDIUM", true],
  ["missing aggressive, HIGH bot needs it → rejected", mutate((c) => delete c.profiles.aggressive), "HIGH", false],
  ["single balanced profile, HIGH bot → rejected", oneProfile, "HIGH", false],

  ["stale strategy_profiles.json (no fees)", stale, undefined, false],
  ["null", null, undefined, false],
  ["not an object", "nope", undefined, false],
  ["missing fees block", mutate((c) => delete c.fees), undefined, false],
  ["no profiles object at all", mutate((c) => delete c.profiles), undefined, false],
  ["empty profiles object", mutate((c) => (c.profiles = {})), undefined, false],
  ["tp/w length mismatch", mutate((c) => c.profiles.balanced.w.pop()), undefined, false],
  ["weights sum to 0.9 (rungs left uncovered)", mutate((c) => (c.profiles.safe.w = [0.1, 0.1, 0.15, 0.2, 0.22, 0.13])), undefined, false],
  ["weights sum to 1.2 (would over-close)", mutate((c) => (c.profiles.safe.w = [0.3, 0.1, 0.15, 0.2, 0.22, 0.23])), undefined, false],
  ["be beyond the rung count", mutate((c) => (c.profiles.aggressive.be = 9)), undefined, false],
  ["negative stop-loss", mutate((c) => (c.profiles.safe.sl = -4)), undefined, false],
  ["stop-loss of 100%", mutate((c) => (c.profiles.safe.sl = 100)), undefined, false],
  ["leverage 0", mutate((c) => (c.profiles.balanced.lev = 0)), undefined, false],
  ["a zero-distance tp rung", mutate((c) => (c.profiles.safe.tp[0] = 0)), undefined, false],
  ["a negative weight", mutate((c) => (c.profiles.safe.w[0] = -0.1)), undefined, false],
  // A malformed profile the bot won't trade is still a real error — the same JSON
  // could later be published at that tier.
  ["a malformed profile the bot won't trade", mutate((c) => (c.profiles.aggressive.w = [2])), "MEDIUM", false],
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
