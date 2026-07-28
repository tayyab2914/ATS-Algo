// Guards the per-bot JSON signal vocabulary. Three properties matter, and every
// case below pins one of them:
//
//   1. A bot with NO mapping behaves exactly as the hardcoded receiver did.
//   2. A mapping only ever ADDS words — the built-ins never stop working, so
//      re-wording a bot cannot silence an alert that is live right now.
//   3. A word means one thing. Anything that could resolve two ways is refused at
//      save time rather than decided by iteration order on the money path.
//
// Run: npx tsx scripts/verify-signal-map.ts
import {
  acceptedWords,
  DEFAULT_ACTION_FIELD,
  normalizeSignalMap,
  parseSignalMap,
  payloadFor,
  readCommandWord,
  resolveCommand,
  signalMapError,
  type SignalCommand,
  type SignalMap,
} from "../lib/execution/signal-map.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const NONE: SignalMap = {};
/** The shape the client's updated indicator produces: its own key, its own words. */
const CUSTOM: SignalMap = {
  field: "signal",
  words: { enter_long: ["LONG"], enter_short: ["SHORT"], exit: ["CLOSE"], tp1: ["TAKE1"] },
};

console.log("\n1. A bot with no mapping is the old receiver, exactly");
for (const [word, action, side] of [
  ["enter_long", "ENTER", "LONG"],
  ["enter_short", "ENTER", "SHORT"],
  ["buy", "ENTER", "LONG"],
  ["sell", "ENTER", "SHORT"],
  ["exit", "EXIT", null],
  ["tp1", "TP1", null],
  ["tp10", "TP10", null],
  ["  ENTER_LONG  ", "ENTER", "LONG"], // trimmed and case-folded, as before
] as const) {
  const r = resolveCommand(word, NONE);
  check(`"${word}" → ${action}${side ? `/${side}` : ""}`, r?.action === action && (r?.side ?? null) === side, r ? "" : "unresolved");
}
check('"tp11" is not a command', resolveCommand("tp11", NONE) === null);
check('"{{strategy.order.action}}" is not a command', resolveCommand("{{strategy.order.action}}", NONE) === null);
check("an empty word resolves to nothing", resolveCommand("   ", NONE) === null);

console.log("\n2. A mapping ADDS words; the built-ins keep working");
check('custom "LONG" → ENTER/LONG', resolveCommand("LONG", CUSTOM)?.side === "LONG");
check('custom "SHORT" → ENTER/SHORT', resolveCommand("SHORT", CUSTOM)?.side === "SHORT");
check('custom "CLOSE" → EXIT', resolveCommand("CLOSE", CUSTOM)?.action === "EXIT");
check('custom "TAKE1" → TP1', resolveCommand("TAKE1", CUSTOM)?.action === "TP1");
check('built-in "enter_long" STILL works on a remapped bot', resolveCommand("enter_long", CUSTOM)?.side === "LONG");
check('built-in "tp3" still works on a remapped bot', resolveCommand("tp3", CUSTOM)?.action === "TP3");
check("case-insensitive against the custom word", resolveCommand("long", CUSTOM)?.side === "LONG");

console.log("\n3. Reading the command out of the body");
check(
  "custom key is read",
  readCommandWord({ signal: "LONG", secret: "s" }, CUSTOM) === "LONG",
);
check(
  "`action` stays a fallback on a remapped bot",
  readCommandWord({ action: "enter_long", secret: "s" }, CUSTOM) === "enter_long",
);
check(
  "the custom key WINS when both are present",
  readCommandWord({ signal: "SHORT", action: "enter_long" }, CUSTOM) === "SHORT",
);
check("a non-string command is ignored", readCommandWord({ action: { x: 1 } } as Record<string, unknown>, NONE) === null);
check("a missing command is null", readCommandWord({ secret: "s" }, NONE) === null);
check("default key needs no mapping", readCommandWord({ action: "exit" }, NONE) === "exit");

console.log("\n4. Collisions are refused at save time");
type Case = [string, SignalMap, boolean];
const cases: Case[] = [
  ["empty mapping", NONE, true],
  ["the client's indicator wiring", CUSTOM, true],
  ["several words for one command", { words: { enter_long: ["LONG", "L", "go_long"] } }, true],
  ["a custom key", { field: "signal" }, true],
  // The dangerous one: one word, two directions.
  ["same word on long and short", { words: { enter_long: ["GO"], enter_short: ["GO"] } }, false],
  ["same word differing only in case", { words: { enter_long: ["Go"], enter_short: ["go"] } }, false],
  ["same word differing only in padding", { words: { enter_long: [" go "], enter_short: ["go"] } }, false],
  // A custom word that is another command's built-in is the same hazard: built-ins
  // are always accepted, so it would silently keep the built-in's meaning.
  ["re-using the built-in `sell` for a LONG", { words: { enter_long: ["sell"] } }, false],
  ["re-using the built-in `tp2` for tp5", { words: { tp5: ["tp2"] } }, false],
  ["a word may repeat within one command", { words: { enter_long: ["LONG", "long"] } }, true],
  ["`secret` cannot carry the command", { field: "secret" }, false],
  ["a key with spaces", { field: "my signal" }, false],
  ["a key starting with a digit", { field: "1signal" }, false],
  ["an unfilled placeholder as a word", { words: { exit: ["{{strategy.order.action}}"] } }, false],
  ["too many words for one command", { words: { exit: ["a", "b", "c", "d", "e", "f", "g"] } }, false],
];
for (const [label, map, shouldPass] of cases) {
  const error = signalMapError(map);
  check(label, shouldPass ? error === null : error !== null, error ?? "accepted");
}

console.log("\n5. The bodies the panel tells you to paste are bodies the receiver accepts");
for (const map of [NONE, CUSTOM]) {
  const which = map.field ? "custom" : "default";
  for (const command of ["enter_long", "enter_short", "exit", "tp1"] as SignalCommand[]) {
    const body = JSON.parse(payloadFor(map, command, "SEC"));
    const word = readCommandWord(body, map);
    const resolved = word ? resolveCommand(word, map) : null;
    check(
      `${which}: ${command} body round-trips`,
      resolved?.command === command && body.secret === "SEC",
      JSON.stringify(body),
    );
  }
}
check(
  "the custom body uses the custom key",
  Object.keys(JSON.parse(payloadFor(CUSTOM, "enter_long", "SEC"))).includes("signal"),
);
check(
  "the default body uses `action`",
  Object.keys(JSON.parse(payloadFor(NONE, "enter_long", "SEC"))).includes(DEFAULT_ACTION_FIELD),
);

console.log("\n6. Storage: nothing redundant is persisted, junk is discarded");
check("an empty mapping stores as null", normalizeSignalMap(NONE) === null);
check("re-typing a built-in stores as null", normalizeSignalMap({ words: { enter_long: ["enter_long"] } }) === null);
check("the default key is not stored", normalizeSignalMap({ field: DEFAULT_ACTION_FIELD }) === null);
check("a real mapping is stored", normalizeSignalMap(CUSTOM) !== null);
check(
  "whitespace-only words are dropped",
  normalizeSignalMap({ words: { exit: ["  ", ""] } }) === null,
);
check("a column of junk parses to empty", Object.keys(parseSignalMap("nonsense")).length === 0);
check("a null column parses to empty", Object.keys(parseSignalMap(null)).length === 0);
check(
  "unknown commands in the column are dropped",
  parseSignalMap({ words: { enter_long: ["X"], not_a_command: ["Y"] } }).words?.enter_long?.[0] === "X" &&
    !("not_a_command" in (parseSignalMap({ words: { not_a_command: ["Y"] } }).words ?? {})),
);
check(
  "a round trip through the column preserves the mapping",
  JSON.stringify(parseSignalMap(normalizeSignalMap(CUSTOM))) === JSON.stringify(normalizeSignalMap(CUSTOM)),
);

console.log("\n7. The rejection message names what this bot would have accepted");
check("built-ins are listed", acceptedWords(NONE).includes("enter_long") && acceptedWords(NONE).includes("buy"));
check("custom words are listed too", acceptedWords(CUSTOM).includes("LONG") && acceptedWords(CUSTOM).includes("enter_long"));

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
