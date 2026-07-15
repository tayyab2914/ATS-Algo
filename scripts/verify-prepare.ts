// Symbol resolution + the arm-time preparation fingerprint.
//
// Reads public Bitget markets and the market_cache table. Never sends an order and
// never authenticates, so it is safe to run against the live database.
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-prepare.ts
import "dotenv/config";
import { MARGIN_MODE, preparedKey } from "../lib/execution/prepare";
import { DEMO_FALLBACK_SYMBOL, resolveSymbol, toSwapSymbol } from "../lib/execution/symbol";
import { prisma } from "../lib/db";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

async function main() {
  console.log("── ticker → swap symbol ──");
  const cases: [string | null, string | null][] = [
    ["BTC", "BTC/USDT:USDT"],
    ["btc", "BTC/USDT:USDT"],
    ["  BTC  ", "BTC/USDT:USDT"],
    ["BTCUSDT", "BTC/USDT:USDT"],
    ["BTCUSD", "BTC/USDT:USDT"],
    ["BTCPERP", "BTC/USDT:USDT"],
    // The regression: a single alternation strips only ".P", leaving "BTCUSDT".
    ["BTCUSDT.P", "BTC/USDT:USDT"],
    ["ETHUSDT.P", "ETH/USDT:USDT"],
    ["USDT", "USDT/USDT:USDT"], // nothing but a suffix — falls back to the raw ticker
    ["", null],
    [null, null],
  ];
  for (const [input, expected] of cases) {
    const got = toSwapSymbol(input);
    check(`${JSON.stringify(input)} → ${expected}`, got === expected, got === expected ? "" : `got ${got}`);
  }

  console.log("\n── resolveSymbol against the real venue ──");
  const btc = await resolveSymbol("Bitget", "BTC", true);
  check("BTC resolves on demo, unsubstituted", btc.symbol === "BTC/USDT:USDT" && !btc.substituted);
  check("carries the market descriptor", btc.market.id === "BTCUSDT", `id=${btc.market.id}`);

  // Bitget lists equity perps LIVE (AAPL, TSLA, NVDA, GOOGL, MSFT) but none of
  // them on demo. So an equity bot trades the real instrument live, and is
  // silently substituted to BTC on demo — which is why `substituted` must be
  // surfaced: demo results for such a bot do not describe its live behaviour.
  const aaplLive = await resolveSymbol("Bitget", "AAPL", false);
  check("AAPL is a real live equity perp, unsubstituted", aaplLive.symbol === "AAPL/USDT:USDT" && !aaplLive.substituted, aaplLive.market.id);

  const aaplDemo = await resolveSymbol("Bitget", "AAPL", true);
  check("AAPL is absent from demo → substitutes the fallback", aaplDemo.symbol === DEMO_FALLBACK_SYMBOL && aaplDemo.substituted);
  check("but records what was actually requested", aaplDemo.requested === "AAPL/USDT:USDT", aaplDemo.requested);

  // Live must never silently trade an instrument the bot didn't ask for.
  let threw = "";
  try {
    await resolveSymbol("Bitget", "ZZZZ", false);
  } catch (error) {
    threw = error instanceof Error ? error.message : String(error);
  }
  check("live REFUSES to substitute an unlisted instrument", threw === "NO_MARKET:ZZZZ/USDT:USDT", threw || "did not throw");

  const zzzzDemo = await resolveSymbol("Bitget", "ZZZZ", true);
  check("demo substitutes an unlisted instrument", zzzzDemo.symbol === DEMO_FALLBACK_SYMBOL && zzzzDemo.substituted);

  let noTicker = "";
  try {
    await resolveSymbol("Bitget", null, true);
  } catch (error) {
    noTicker = error instanceof Error ? error.message : String(error);
  }
  check("a bot with no ticker throws NO_TICKER", noTicker === "NO_TICKER", noTicker);

  console.log("\n── prepared fingerprint ──");
  const base = preparedKey("Bitget", true, "BTC/USDT:USDT", 7);
  check("stable for identical settings", base === preparedKey("Bitget", true, "BTC/USDT:USDT", 7), base);
  check("leverage change invalidates", base !== preparedKey("Bitget", true, "BTC/USDT:USDT", 10));
  check("symbol change invalidates", base !== preparedKey("Bitget", true, "ETH/USDT:USDT", 7));
  check("demo→live invalidates", base !== preparedKey("Bitget", false, "BTC/USDT:USDT", 7));
  check("venue change invalidates", base !== preparedKey("Bybit", true, "BTC/USDT:USDT", 7));
  // The bug the fingerprint exists to prevent: a timestamp cannot tell 4x from 10x.
  check("distinguishes 4x from 10x on the same instrument", preparedKey("Bitget", false, "BTC/USDT:USDT", 4) !== preparedKey("Bitget", false, "BTC/USDT:USDT", 10));

  // The silent-CROSS bug. The `demo|live` segment is the SANDBOX mode, NOT the margin
  // mode — so before margin mode was a segment, flipping the platform to isolated left
  // every stored fingerprint still matching: `ensurePrepared` short-circuited,
  // `setMarginMode` was never re-sent, and every account kept trading on CROSS while
  // its orders claimed isolated. Nothing else in this suite can catch that.
  check(
    "margin-mode change invalidates",
    preparedKey("Bitget", true, "BTC/USDT:USDT", 7, "cross") !== preparedKey("Bitget", true, "BTC/USDT:USDT", 7, "isolated"),
  );
  check("the default margin mode is ISOLATED — cross is never used", base === preparedKey("Bitget", true, "BTC/USDT:USDT", 7, "isolated"), base);
  check("MARGIN_MODE constant is isolated", MARGIN_MODE === "isolated", MARGIN_MODE);

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
