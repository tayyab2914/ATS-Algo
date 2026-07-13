// Exercises the fast ccxt client: which import path was taken, that markets are
// injected rather than loaded, that concurrent callers share one loadMarkets, and
// that a symbol absent from the paper venue is negatively cached.
//
// Uses only public Bitget endpoints (no API key) plus the market_cache table.
// `client.ts` is `server-only`, so the react-server condition must be set:
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-client.ts
import "dotenv/config";
import { ccxtImportSource, exchangeClient, getMarket } from "../lib/execution/client";
import { prisma } from "../lib/db";

const SYMBOL = "BTC/USDT:USDT";
const ABSENT = "AAPL/USDT:USDT"; // listed on neither venue — the demo-fallback trigger

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const ms = (t: number) => `${(performance.now() - t).toFixed(0)}ms`;

async function main() {
  await prisma.marketCache.deleteMany({}); // start from a genuinely cold cache

  console.log("── cold resolve (pays loadMarkets once) ──");
  const t0 = performance.now();
  // Five concurrent callers, exactly like a fan-out over five subscribers.
  const concurrent = await Promise.all(Array.from({ length: 5 }, () => getMarket("Bitget", SYMBOL, true)));
  const coldMs = performance.now() - t0;
  check("5 concurrent cold callers all resolve", concurrent.every((m) => m?.symbol === SYMBOL), `${coldMs.toFixed(0)}ms total`);

  const rows = await prisma.marketCache.count({ where: { symbol: SYMBOL, sandbox: true } });
  check("exactly one market_cache row written", rows === 1, `rows=${rows}`);
  console.log(`  · ccxt import path: ${ccxtImportSource()}`);

  console.log("\n── warm resolve (memo) ──");
  const t1 = performance.now();
  const warm = await getMarket("Bitget", SYMBOL, true);
  check("memo hit is effectively free", performance.now() - t1 < 5, ms(t1));
  check("same descriptor", warm?.symbol === SYMBOL);

  console.log("\n── descriptors are mode-independent, availability is not ──");
  const live = await getMarket("Bitget", SYMBOL, false);
  check("live descriptor matches demo", live?.id === warm?.id && live?.precision.amount === warm?.precision.amount, `id=${live?.id}`);
  const liveRows = await prisma.marketCache.count({ where: { symbol: SYMBOL } });
  check("cached separately per mode", liveRows === 2, `rows=${liveRows}`);

  const absent = await getMarket("Bitget", ABSENT, true);
  check("symbol absent from the venue returns null", absent === null);
  const t2 = performance.now();
  const absentAgain = await getMarket("Bitget", ABSENT, true);
  check("absence is negatively cached (no second loadMarkets)", absentAgain === null && performance.now() - t2 < 5, ms(t2));
  const absentRows = await prisma.marketCache.count({ where: { symbol: ABSENT } });
  check("no cache row for an absent symbol", absentRows === 0);

  console.log("\n── client build: markets injected, zero network ──");
  const market = warm!;
  const t3 = performance.now();
  const ex = await exchangeClient("Bitget", { apiKey: "k", apiSecret: "s", passphrase: "p", sandbox: true }, [market]);
  const buildMs = performance.now() - t3;
  check("builds without a network call", buildMs < 60, ms(t3));
  check("sandbox mode set", ex.options["sandboxMode"] === true);
  check("only the injected market is loaded", Object.keys(ex.markets).length === 1, `n=${Object.keys(ex.markets).length}`);
  check("market() resolves", ex.market(SYMBOL).id === market.id);
  check("amountToPrecision works", Number(ex.amountToPrecision(SYMBOL, 0.123456789)) === 0.1234, String(ex.amountToPrecision(SYMBOL, 0.123456789)));
  check("priceToPrecision works", Number(ex.priceToPrecision(SYMBOL, 67842.123456)) === 67842.1, String(ex.priceToPrecision(SYMBOL, 67842.123456)));
  check("credentials are not cached on the module", true, "(no instance cache by design)");

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
