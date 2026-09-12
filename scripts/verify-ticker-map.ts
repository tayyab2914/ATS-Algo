// Guards the per-exchange ticker map — the rules that decide WHICH INSTRUMENT a
// signal opens on each venue.
//
// Why it exists: a bot carries ONE `ticker`, and that only ever worked because the
// venues agree on crypto. "BTC" derives to BTC/USDT:USDT everywhere. Nothing else
// agrees — the same WTI oil contract is NCCO1OILWTI2USD on BingX, AXTI on Bybit
// and Bitget, and WTIOIL on BloFin — so a commodities or metals bot resolved on at
// most one of its allowed venues and threw NO_MARKET on the rest, which surfaces
// to a member as "the bot just didn't trade".
//
// The two properties that matter, and are asserted here:
//
//   1. A bot with NO overrides behaves exactly as it did before the map existed.
//      Every crypto bot on the platform is in that set, so a regression here is a
//      regression for all of them.
//   2. An override applies to ONE venue and never leaks to another, survives the
//      normalisation the editor and both routes run, and is dropped when the bot
//      stops being allowed on that venue.
//
// Pure logic — no venue and no database is contacted. The live half (does
// `resolveSymbol` actually find an instrument by the venue's own name?) belongs to
// scripts/verify-prepare.ts, which talks to a real paper venue.
//
// The condition flag is only there because it imports `toSwapSymbol` out of the
// server-only execution module; nothing here needs a server:
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-ticker-map.ts
import { BOT_EXCHANGES } from "../lib/bot-exchanges.ts";
import {
  describeTickerMap,
  normalizeTickerMap,
  parseTickerMap,
  sameTickerMap,
  tickerFor,
  tickerMapError,
  TICKER_MAX_LENGTH,
} from "../lib/ticker-map.ts";
import { toSwapSymbol } from "../lib/execution/symbol.ts";
import { botTickerMapSchema } from "../lib/validation.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const ALL = BOT_EXCHANGES.map((e) => e.value);

/** The case this feature was built for, in the owner's own words. */
const OIL = { Bingx: "NCCO1OILWTI2USD", Bybit: "AXTI", Bitget: "AXTI", Blofin: "WTIOIL" };

console.log("\n1. A bot with no overrides is untouched");
const crypto = { ticker: "BTC", tickerMap: null };
for (const venue of ALL) {
  check(`${venue} still asks for BTC`, tickerFor(crypto, venue) === "BTC");
}
check("an unknown venue falls back to the ticker", tickerFor(crypto, "Kraken") === "BTC");
check("no venue at all falls back to the ticker", tickerFor(crypto, null) === "BTC");
check("a bot with neither ticker nor map resolves to null", tickerFor({ ticker: null }, "Bybit") === null);

console.log("\n2. An override applies to its own venue and no other");
const oilBot = { ticker: "WTI", tickerMap: OIL };
check("BingX gets its own name", tickerFor(oilBot, "Bingx") === "NCCO1OILWTI2USD");
check("Bybit gets its own name", tickerFor(oilBot, "Bybit") === "AXTI");
check("BloFin gets its own name", tickerFor(oilBot, "Blofin") === "WTIOIL");
const partial = { ticker: "WTI", tickerMap: { Bingx: "NCCO1OILWTI2USD" } };
check("a venue with no entry still falls back to the ticker", tickerFor(partial, "Bybit") === "WTI");
check("venue keys match case-insensitively", tickerFor({ ticker: "WTI", tickerMap: { bingx: "X" } }, "Bingx") === "X");

console.log("\n3. A malformed column can never break the order path");
for (const bad of [null, undefined, "AXTI", 42, ["AXTI"], { Bybit: 42 }, { Bybit: "   " }]) {
  check(`${JSON.stringify(bad) ?? "undefined"} reads as no overrides`, Object.keys(parseTickerMap(bad)).length === 0);
}
check("a malformed map still falls back to the ticker", tickerFor({ ticker: "BTC", tickerMap: "junk" }, "Bybit") === "BTC");

console.log("\n4. Normalisation is narrowed to the venues the bot is allowed on");
const narrowed = normalizeTickerMap(OIL, ["Bybit", "Bingx"]);
check("entries for allowed venues survive", narrowed.Bybit === "AXTI" && narrowed.Bingx === "NCCO1OILWTI2USD");
check("entries for venues the bot lost are dropped", !("Blofin" in narrowed) && !("Bitget" in narrowed));
check("unknown venues are dropped", !("Kraken" in normalizeTickerMap({ Kraken: "XBT" }, [...ALL, "Kraken"])));
check("venue keys are canonicalised", normalizeTickerMap({ bYbIt: "axti" }, ["Bybit"]).Bybit === "AXTI");
check("values are upper-cased", normalizeTickerMap({ Bybit: "axti" }, ALL).Bybit === "AXTI");
check("blank values are dropped, not stored empty", Object.keys(normalizeTickerMap({ Bybit: "  " }, ALL)).length === 0);

console.log("\n5. Bad instrument names are refused before they can reach a venue");
check("the oil map is accepted", tickerMapError(OIL) === null);
check("a ccxt symbol typed in directly is accepted", tickerMapError({ Bybit: "BTC/USDT:USDT" }) === null);
check("a dashed venue id is accepted", tickerMapError({ Bingx: "BTC-USDT" }) === null);
check("a name with a space is refused", tickerMapError({ Bybit: "WTI OIL" }) !== null);
check("a name with a quote is refused", tickerMapError({ Bybit: 'A"B' }) !== null);
check("an over-long name is refused", tickerMapError({ Bybit: "A".repeat(TICKER_MAX_LENGTH + 1) }) !== null);
check("the error names the venue", (tickerMapError({ Bybit: "WTI OIL" }) ?? "").includes("Bybit"));

console.log("\n6. The wire schema agrees with the editor's own rules");
check("the oil map parses", botTickerMapSchema.safeParse(OIL).success);
check("an empty map parses (it clears every override)", botTickerMapSchema.safeParse({}).success);
check("a non-string value is refused", !botTickerMapSchema.safeParse({ Bybit: 42 }).success);
check(
  `more entries than there are venues is refused (${ALL.length} exist)`,
  !botTickerMapSchema.safeParse({ ...OIL, A: "A", B: "B", C: "C" }).success,
);
check(
  "an over-long value is refused by the schema too",
  !botTickerMapSchema.safeParse({ Bybit: "A".repeat(TICKER_MAX_LENGTH + 1) }).success,
);

console.log("\n7. The symbol derivation leaves crypto alone and passes ccxt symbols through");
check("BTC → BTC/USDT:USDT", toSwapSymbol("BTC") === "BTC/USDT:USDT");
check("BTCUSDT.P → BTC/USDT:USDT", toSwapSymbol("BTCUSDT.P") === "BTC/USDT:USDT");
// The pass-through is what makes an exotic instrument addressable at all: the
// derivation assumes a USDT-margined perpetual, and would turn a venue's own oil
// id into a market that exists nowhere.
check("a ccxt symbol is passed through untouched", toSwapSymbol("BTC/USD:BTC") === "BTC/USD:BTC");
check(
  "a venue's own id is NOT mangled into a fake pair",
  toSwapSymbol("NCCO1OILWTI2USD") !== "NCCO1OILWTI2USD/USDT:USDT",
  toSwapSymbol("NCCO1OILWTI2USD") ?? "",
);
check("an empty ticker is null (the caller raises NO_TICKER)", toSwapSymbol("") === null && toSwapSymbol(null) === null);

console.log("\n8. The editor's dirty check and change note");
check("identical maps compare equal", sameTickerMap(OIL, { ...OIL }));
check("a changed value is detected", !sameTickerMap(OIL, { ...OIL, Bybit: "AXTI2" }));
check("a removed entry is detected", !sameTickerMap(OIL, { Bybit: "AXTI" }));
check("an empty map describes as “none”", describeTickerMap({}) === "none");
check("the note reads the way the owner wrote it", describeTickerMap({ Bingx: "NCCO1OILWTI2USD" }) === "Bingx → NCCO1OILWTI2USD");

console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
