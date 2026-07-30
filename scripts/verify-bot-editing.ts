// Guards the rules that decide whether a bot can be SAVED.
//
// The bug this file exists for: the editor validated the config already stored on
// the row, on mount. Any bot whose JSON predates the current schema — the ones with
// no `fees` block, say — therefore had "Save" permanently disabled behind a stop-
// ladder message, no matter what was edited. Renaming such a bot was impossible.
//
// The rule that replaces it, enforced identically here and in the PATCH route:
//
//   - A config being UPLOADED is new material and must satisfy the whole schema.
//   - A config already ON THE ROW is grandfathered. Retuning its ladder or its
//     leverage is held to the ladder's GEOMETRY only — the bar the row already
//     meets — so an old bot stays editable without being rewritten first.
//   - Metadata (name, timeframe, category) is never held to the config at all.
//
// Run: npx tsx scripts/verify-bot-editing.ts
import { readFileSync } from "node:fs";
import { profileLeverage, withLeverage, withRatchetPct, type BotConfig } from "../lib/bot-config.ts";
import { botConfigError, ladderGeometryError, leverageError } from "../lib/validation.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const modern = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
/** The real shape of a grandfathered row: one profile, no `fees` block. */
const legacy = JSON.parse(readFileSync("fixtures/stale-single-profile.json", "utf8")) as BotConfig;

console.log("\n1. The two bars are genuinely different");
check("a legacy config FAILS the upload bar", botConfigError(legacy) !== null, botConfigError(legacy) ?? "");
check("…but PASSES the geometry bar", ladderGeometryError(legacy) === null);
check("a modern config passes both", botConfigError(modern) === null && ladderGeometryError(modern) === null);

console.log("\n2. A grandfathered bot can still be retuned");
check("sound ladder on a legacy config is allowed", ladderGeometryError(withRatchetPct(legacy, 25)) === null);
check(
  "unsound ladder on a legacy config is still REFUSED",
  ladderGeometryError(withRatchetPct(legacy, 10)) !== null,
  ladderGeometryError(withRatchetPct(legacy, 10))?.message.slice(0, 60) ?? "",
);
check(
  "…and a too-aggressive one too",
  ladderGeometryError(withRatchetPct(legacy, 100)) !== null,
);
check("leverage on a legacy config touches nothing else", ladderGeometryError(withLeverage(legacy, "LOW", 20)) === null);
// The bar for an upload does NOT move: a legacy file cannot be smuggled in by
// attaching a valid ladder to it.
check("a legacy config with a good ladder is STILL not uploadable", botConfigError(withRatchetPct(legacy, 25)) !== null);

console.log("\n3. Geometry is judged on the COMPOSED config, not the raw upload");
// Uploading a sound file and typing an unsound ladder in the same save must fail.
check("modern config + unsound ladder → refused", botConfigError(withRatchetPct(modern, 10), "MEDIUM") !== null);
check("modern config + sound ladder → accepted", botConfigError(withRatchetPct(modern, 25), "MEDIUM") === null);

console.log("\n4. A one-rung profile has no ladder to be wrong about");
// G3 divides by `tp.length - 1`. Before the guard, a single-rung profile reported
// "never locks in profit … use at least ~Infinity" and could never be saved.
const oneRung: BotConfig = {
  ...modern,
  profiles: { balanced: { tp: [0.5], w: [1], sl: 3, be: 1, lev: 5 } },
};
check("no ladder → fine", ladderGeometryError(oneRung) === null);
check("with a ladder → still fine, not 'use at least ~Infinity'", ladderGeometryError(withRatchetPct(oneRung, 25)) === null);
check("and it passes the full schema at MEDIUM", botConfigError(withRatchetPct(oneRung, 25), "MEDIUM") === null);

console.log("\n5. Leverage: read, write, and stay pure");
check("reads the traded profile", profileLeverage(modern, "LOW") === 4 && profileLeverage(modern, "MEDIUM") === 7 && profileLeverage(modern, "HIGH") === 10);
check("null when the profile is absent", profileLeverage(legacy, "HIGH") === null);
const bumped = withLeverage(modern, "MEDIUM", 3);
check("writes only the traded profile", bumped.profiles.balanced?.lev === 3);
check("…leaving the others alone", bumped.profiles.safe?.lev === 4 && bumped.profiles.aggressive?.lev === 10);
check("the caller's config is not mutated", modern.profiles.balanced?.lev === 7);
check("a missing profile is a no-op, not a crash", withLeverage(legacy, "HIGH", 9) === legacy);
check("the result still validates", botConfigError(bumped, "MEDIUM") === null);

console.log("\n6. Leverage bounds match the schema's");
check("1x is the floor", leverageError(1) === null && leverageError(0.5) !== null);
check("125x is the ceiling", leverageError(125) === null && leverageError(126) !== null);
check("NaN is refused", leverageError(Number.NaN) !== null);
check("the schema agrees at the edges", botConfigError(withLeverage(modern, "MEDIUM", 125), "MEDIUM") === null);
check("…and rejects beyond them", botConfigError(withLeverage(modern, "MEDIUM", 200), "MEDIUM") !== null);

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
