// The venue adapter registry, exercised THROUGH THE ENGINE rather than raw ccxt — which is
// the whole point. The probe scripts all construct `new ccxt.bybit()` directly and prove
// nothing about whether the engine can trade a second venue. This proves that.
//
// Asserts per venue: the deep single-file import is taken, markets load and cache under the
// venue's own key, a client builds with no network, and the PAPER MODE lands on the right
// place — which differs by venue and is silent when wrong (Bitget sets a header on the live
// host; Bybit swaps to a different host entirely, and has TWO paper hosts to get wrong).
//
// Also asserts the demo-substitution asymmetry: Bitget stands in for an unlisted instrument
// because its paper venue is thin, Bybit must NOT because its demo lists everything.
//
// Public endpoints only — no API key, no orders. Writes market_cache rows, exactly as the
// order path would.
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-venue-registry.ts
import "dotenv/config";
import { BOT_EXCHANGES } from "../lib/bot-exchanges";
import { prisma } from "../lib/db";
import { adapterFor, ccxtImportSource, demoFallbackFor, exchangeClient, getMarket, warmCcxt } from "../lib/execution/client";
import { resolveSymbol } from "../lib/execution/symbol";

const SYMBOL = "BTC/USDT:USDT";
const ABSENT_TICKER = "ZZZZ"; // listed on no venue — the substitution trigger

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);

const NO_CREDS = { apiKey: "", apiSecret: "", sandbox: false };

async function main() {
  console.log("── registry shape ──");
  const wired = BOT_EXCHANGES.filter((v) => v.wired).map((v) => v.value);
  const withAdapter = BOT_EXCHANGES.filter((v) => {
    try { adapterFor(v.value); return true; } catch { return false; }
  }).map((v) => v.value);
  note("wired (release gate)", wired.join(", ") || "(none)");
  note("has an adapter (capability)", withAdapter.join(", ") || "(none)");
  // wired ⊆ adapters. The reverse is normal: an adapter under test is not yet released.
  check(
    "every WIRED venue has an adapter (else each signal throws UNSUPPORTED_EXCHANGE)",
    wired.every((v) => withAdapter.includes(v)),
    wired.filter((v) => !withAdapter.includes(v)).join(", ") || "ok",
  );

  let threw = "";
  try { adapterFor("Kraken"); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
  check("an unknown venue throws UNSUPPORTED_EXCHANGE", threw === "UNSUPPORTED_EXCHANGE:Kraken", threw);

  console.log("\n── warm (imports every wired venue, never rejects) ──");
  const warm = await warmCcxt();
  note("warm result", `${warm.importSource} in ${warm.ms}ms`);
  check("at least one venue imported", warm.importSource !== "none");

  // ── per-venue: markets, cache key, client build, paper mode ──────────────────
  for (const venue of withAdapter) {
    const adapter = adapterFor(venue);
    console.log(`\n── ${venue} (ccxt id ${adapter.ccxtId}) ──`);

    const live = await getMarket(venue, SYMBOL, false);
    check("live market resolves", live?.symbol === SYMBOL, live ? `id=${live.id} amtPrec=${live.precision.amount}` : "null");
    note("min amount", live?.limits?.amount?.min ?? "none");
    note("min cost", live?.limits?.cost?.min ?? "none (no notional floor)");

    const rows = await prisma.marketCache.count({ where: { exchange: venue, symbol: SYMBOL } });
    check("cached under this venue's own key", rows >= 1, `rows=${rows}`);

    // A client with markets injected: no loadMarkets, no network.
    const started = performance.now();
    const ex = await exchangeClient(venue, { ...NO_CREDS }, [live!]);
    const buildMs = performance.now() - started;

    // The import path actually taken — the deep single-file import is the fast one.
    //
    // Asserted AFTER the client build, deliberately. `getMarket` above can be satisfied entirely
    // from `market_cache`, in which case nothing has imported this venue's constructor yet — and
    // only a WIRED venue is guaranteed to have been imported already, because that is all
    // `warmCcxt` covers. Checking before the build therefore failed for an adapter under test
    // through no fault of the adapter, and did so only on a warm cache, which made it look flaky.
    check(
      "took the single-exchange deep import (not full ccxt)",
      (ccxtImportSource() ?? "").includes(`${adapter.ccxtId}:${adapter.ccxtId}-only`),
      ccxtImportSource() ?? "(none)",
    );
    check("client builds without a network call", buildMs < 120, `${buildMs.toFixed(0)}ms`);
    check("only the injected market is loaded", Object.keys(ex.markets).length === 1, `n=${Object.keys(ex.markets).length}`);
    check("amountToPrecision works", Number.isFinite(Number(ex.amountToPrecision(SYMBOL, 0.123456789))), String(ex.amountToPrecision(SYMBOL, 0.123456789)));

    // ── paper mode: the bit that is silent when wrong ──────────────────────────
    const paper = await exchangeClient(venue, { ...NO_CREDS, sandbox: true }, [live!]);
    const host = JSON.stringify(paper.urls.api);
    note("paper host", host.length > 90 ? `${host.slice(0, 90)}…` : host);
    if (venue === "Bitget") {
      // Bitget swaps NO url — it sets a PAPTRADING header on the live host, same key.
      check("Bitget paper = sandboxMode flag, live host", paper.options["sandboxMode"] === true);
      check("…and did NOT change host", !host.includes("demo") && !host.includes("testnet"));
    } else if (venue === "Bybit") {
      // Bybit swaps HOST. api-demo is the demo engine; api-testnet is a DIFFERENT exchange
      // with its own registration and keys. Landing on testnet fails auth and looks like a
      // bad key, so this assertion is the one that matters most in this file.
      check("Bybit paper = api-demo host", host.includes("api-demo"), host.slice(0, 70));
      check("…and NOT api-testnet (a separate exchange, separate keys)", !host.includes("testnet"));
      check("enableDemoTrading flag set", paper.options["enableDemoTrading"] === true);
    }
    // Live must never be on a paper host, whatever the mechanism.
    const liveHost = JSON.stringify((await exchangeClient(venue, { ...NO_CREDS }, [live!])).urls.api);
    check("live client is on the real host", !liveHost.includes("demo") && !liveHost.includes("testnet"));
  }

  // ── the demo-substitution asymmetry ─────────────────────────────────────────
  console.log("\n── demo substitution is PER VENUE ──");
  for (const venue of withAdapter) {
    const fallback = demoFallbackFor(venue);
    note(`${venue} fallback symbol`, fallback ?? "(none — demo lists everything)");
    const resolved = await resolveSymbol(venue, ABSENT_TICKER, true).then(
      (r) => ({ ok: true as const, r }),
      (e) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }),
    );
    if (fallback) {
      check(
        `${venue}: an unlisted instrument SUBSTITUTES in sandbox`,
        resolved.ok && resolved.r.substituted && resolved.r.symbol === fallback,
        resolved.ok ? `${resolved.r.requested} → ${resolved.r.symbol}` : resolved.message,
      );
    } else {
      check(
        `${venue}: an unlisted instrument RAISES rather than substituting`,
        !resolved.ok && resolved.message.startsWith("NO_MARKET:"),
        resolved.ok ? `substituted to ${resolved.r.symbol} — WRONG` : resolved.message,
      );
    }
    // A real instrument must resolve unsubstituted on every venue, in both modes.
    const real = await resolveSymbol(venue, "BTC", true);
    check(`${venue}: a listed instrument never substitutes`, real.symbol === SYMBOL && !real.substituted, real.symbol);
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (error) => { console.error("\nERROR:", error); await prisma.$disconnect(); process.exit(1); });
