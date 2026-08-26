// Guards the rules that decide whether a bot can be SAVED.
//
// The bug this file exists for: the editor validated the config already stored on
// the row, on mount. Any bot whose JSON cannot clear today's upload bar therefore
// had "Save" permanently disabled behind a stop-ladder message, no matter what was
// edited. Renaming such a bot was impossible.
//
// The rule that replaces it, enforced identically here and in the PATCH route:
//
//   - A config being UPLOADED is new material and must satisfy the whole schema.
//   - A config already ON THE ROW is grandfathered. Retuning its ladder or its
//     leverage is held to the ladder's GEOMETRY only — the bar the row already
//     meets — so an old bot stays editable without being rewritten first.
//   - Metadata (name, category) is never held to the config at all.
//
// Run: npx tsx scripts/verify-bot-editing.ts
import { readFileSync } from "node:fs";
import { profileLeverage, withLeverage, withRatchetPct, type BotConfig } from "../lib/bot-config.ts";
import { BOT_EXCHANGES } from "../lib/bot-exchanges.ts";
import { botConfigError, botExchangesSchema, ladderGeometryError, leverageError } from "../lib/validation.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const modern = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
const stale = JSON.parse(readFileSync("fixtures/stale-single-profile.json", "utf8")) as BotConfig;
/**
 * The real shape of a grandfathered row: one profile, and a ladder whose weights
 * do not sum to 1.
 *
 * It used to be "one profile, no `fees` block" — an absent fees block was what
 * separated a half-built config from a finished one. That is no longer true: the
 * official Bot Sim output ships without fees ON PURPOSE (those costs are inside
 * the numbers it emits), so a fees-less config now clears the upload bar like any
 * other, and this file's subject would have had no subject left.
 *
 * What is still true — and is the whole point here — is that some stored configs
 * cannot clear that bar, and such a bot must stay renameable and retunable anyway.
 * Weights summing to 1.01 is not a hypothetical: the Bot Sim has emitted exactly
 * that. Geometry never reads `w`, so this passes the geometry bar, which is
 * precisely the split being tested.
 */
const legacy: BotConfig = {
  ...stale,
  profiles: { ...stale.profiles, safe: { ...stale.profiles.safe, w: [0.1, 0.1, 0.15, 0.2, 0.22, 0.24] } },
};

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


console.log("\n7. The admin-allowed exchange set tracks the venue registry");
// THE REGRESSION THIS SECTION EXISTS FOR: the cap was the literal `3` inline in both admin bot
// routes. Adding a fourth venue made the editor offer BingX and then refuse to save it, with a
// raw zod message that named neither the field nor the limit. Nothing here covered it, because
// the schema lived inside a route file where a test could not reach it.
const allVenues = BOT_EXCHANGES.map((e) => e.value);
check(
  `every venue in the registry can be selected at once (${allVenues.length} of them)`,
  botExchangesSchema.safeParse(allVenues).success,
  allVenues.join(", "),
);
check("one venue is fine", botExchangesSchema.safeParse([allVenues[0]]).success);
check("an empty set is allowed (the bot falls back to its legacy single exchange)",
  botExchangesSchema.safeParse([]).success);
check(
  "…but MORE entries than there are venues is still refused",
  !botExchangesSchema.safeParse([...allVenues, "Nonexistent"]).success,
);
check("BingX specifically is accepted", botExchangesSchema.safeParse(["Bingx"]).success);

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
