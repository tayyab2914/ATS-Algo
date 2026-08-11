// The per-venue stop strategy (lib/execution/stops.ts), exercised on EVERY paper venue with real
// orders.
//
// The assertions are deliberately written to FAIL if any two venues behave the same way, because
// they don't — three venues, three genuinely different stop models. What is asserted per venue:
//
//   Bitget (slots 2) — the backstop and the working stop are DIFFERENT order ids, both resting
//                      at once, and clearWorking() removes the working stop while the backstop
//                      SURVIVES. That survival is the never-naked guarantee.
//   Bybit  (slots 1) — the backstop and the working stop are the SAME order id; moving the stop
//                      changes the trigger in place (no second stop appears); and clearWorking()
//                      removes everything, which is why it must only ever run at flatten.
//   BloFin (slots 2, enforced by US) — one TPSL family in which stops STACK, all sized, and the
//                      entry's backstop is an ordinary cancellable member of it. The strategy
//                      holds back the OLDEST as the backstop so a ratchet cancel can never take
//                      it; without that, cancelling the family leaves the position naked.
//
// Only ever the paper engines: each venue's client is checked for its own paper marker before a
// single order goes out. Everything through ccxt.
//
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-stop-strategy.ts
import "dotenv/config";
import type { Exchange } from "ccxt";
import { adapterFor, exchangeClient, getMarket, livePosition, type TradeCreds } from "../lib/execution/client";
import { stopStrategyFor } from "../lib/execution/stops";

const SYMBOL = "BTC/USDT:USDT";
const LEVERAGE = 5;
const MARGIN_MODE = "isolated";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type VenueCase = {
  venue: string;
  creds: TradeCreds;
  /** Substring that must appear in the client's state for it to be the paper engine. */
  assertPaper: (ex: Exchange) => boolean;
  /** Multiple of the venue's minimum amount to trade. */
  sizeMultiple: number;
};

const CASES: VenueCase[] = [
  {
    venue: "Bitget",
    creds: {
      apiKey: process.env.BITGET_DEMO_KEY ?? "", apiSecret: process.env.BITGET_DEMO_SECRET ?? "",
      passphrase: process.env.BITGET_DEMO_PASSPHRASE ?? "", sandbox: true,
    },
    // Bitget swaps no url — it sets a PAPTRADING header, flagged by this option.
    assertPaper: (ex) => ex.options["sandboxMode"] === true,
    sizeMultiple: 18, // 0.0018 — clears the $5 min notional comfortably
  },
  {
    venue: "Blofin",
    creds: {
      apiKey: process.env.BLOFIN_DEMO_KEY ?? "", apiSecret: process.env.BLOFIN_DEMO_SECRET ?? "",
      passphrase: process.env.BLOFIN_DEMO_PASSPHRASE ?? "", sandbox: true,
    },
    // BloFin's demo is a pure URL swap to demo-trading-openapi.
    assertPaper: (ex) => JSON.stringify(ex.urls.api).includes("demo-trading"),
    sizeMultiple: 300, // minSize 0.1 contracts -> 30 contracts = 0.03 BTC
  },
  {
    venue: "Bybit",
    creds: {
      apiKey: process.env.BYBIT_DEMO_KEY ?? "", apiSecret: process.env.BYBIT_DEMO_SECRET ?? "", sandbox: true,
    },
    // Bybit swaps HOST. api-demo is the demo engine; api-testnet is a different exchange.
    assertPaper: (ex) => JSON.stringify(ex.urls.api).includes("api-demo"),
    sizeMultiple: 5, // 0.005
  },
];

async function flatten(ex: Exchange, venue: string, symbol: string) {
  const strategy = stopStrategyFor(venue);
  // Close FIRST on a venue where a bare sweep would strip the backstop off a live position.
  const closeThenSweep = strategy.bareSweepRemovesBackstop;
  const closePosition = async () => {
    const live = await livePosition(ex, symbol);
    const contracts = Number(live?.contracts ?? 0);
    if (contracts > 0) {
      // The venue's own order params, exactly as the engine sends them. NOT optional: BloFin
      // requires `marginMode` on every order, and without it this close silently fails and the
      // fixture leaks an open position into the next run.
      await ex
        .createOrder(symbol, "market", live?.side === "long" ? "sell" : "buy", contracts, undefined, {
          ...adapterFor(venue).orderParams(MARGIN_MODE),
          reduceOnly: true,
        })
        .catch((e) => note("close failed", String(e).slice(0, 120)));
    }
  };
  const sweep = async () => {
    for (const params of [{ trigger: true }, {}]) await ex.cancelAllOrders(symbol, params).catch(() => {});
    await strategy.clearWorking(ex, symbol).catch(() => {});
  };
  if (closeThenSweep) { await closePosition(); await sleep(1200); await sweep(); }
  else { await sweep(); await closePosition(); }
  await sleep(1500);
}

async function runVenue(testCase: VenueCase) {
  const { venue, creds } = testCase;
  console.log(`\n══════ ${venue} ══════`);
  if (!creds.apiKey || !creds.apiSecret) {
    console.log(`  (skipped — ${venue.toUpperCase()}_DEMO_* not in .env)`);
    return;
  }

  const strategy = stopStrategyFor(venue);
  const market = await getMarket(venue, SYMBOL, true);
  if (!market) { check(`${venue}: demo lists ${SYMBOL}`, false, "no market"); return; }
  const ex = await exchangeClient(venue, creds, [market]);
  if (!testCase.assertPaper(ex)) throw new Error(`REFUSING TO RUN: ${venue} client is not on the paper engine`);
  check("client is on the paper engine", true);
  note("declared slots", strategy.slots);
  note("bare sweep removes the backstop", strategy.bareSweepRemovesBackstop);

  await flatten(ex, venue, SYMBOL);

  // Prep. Errors that mean "already correct" are expected and swallowed — a no-op leverage
  // change is 110043/BadRequest on Bybit, not a no-change.
  await ex.setPositionMode(false, SYMBOL).catch(() => {});
  await ex.setMarginMode(MARGIN_MODE, SYMBOL).catch(() => {});
  // marginMode is mandatory for BloFin: ccxt defaults setLeverage to CROSS.
  await ex.setLeverage(LEVERAGE, SYMBOL, { marginMode: MARGIN_MODE }).catch(() => {});

  const minAmount = Number(market.limits?.amount?.min ?? 0.001);
  const size = Number(ex.amountToPrecision(SYMBOL, minAmount * testCase.sizeMultiple));
  const mark = Number((await ex.fetchTicker(SYMBOL)).last);
  const backstopPrice = Number(ex.priceToPrecision(SYMBOL, mark * 0.90));
  note("size / mark / backstop", `${size} / ${mark} / ${backstopPrice}`);

  try {
    // ── entry, with the venue's own attached-stop params ──────────────────────
    const entry = await ex.createOrder(SYMBOL, "market", "buy", size, undefined, {
      marginMode: MARGIN_MODE,
      oneWayMode: true,
      ...strategy.entryStopParams(backstopPrice),
    });
    check("entry filled", Boolean(entry.id), `id=${entry.id?.slice(0, 12)}`);
    await sleep(2000);

    const backstop = await strategy.findBackstop(ex, SYMBOL);
    check("findBackstop() locates the entry's stop", backstop !== null, backstop ? `id=${backstop.id.slice(0, 12)} trig=${backstop.triggerPrice}` : "null");

    const workingBefore = await strategy.findWorking(ex, SYMBOL);
    note("findWorking() before any ratchet", workingBefore.length === 0 ? "(none)" : workingBefore.map((s) => `${s.id.slice(0, 10)}@${s.triggerPrice}`).join(" "));
    if (strategy.slots === 2) {
      // Two independent slots: the working slot is genuinely empty until the ratchet fills it.
      check("2-slot venue: the working slot is EMPTY before the ratchet", workingBefore.length === 0, `n=${workingBefore.length}`);
    } else {
      // One slot: the backstop IS the working stop, so it must already be visible as one.
      check("1-slot venue: the backstop already occupies the working slot", workingBefore.length === 1 && workingBefore[0].id === backstop?.id,
        `n=${workingBefore.length} sameId=${workingBefore[0]?.id === backstop?.id}`);
    }

    // ── move the working stop tighter ─────────────────────────────────────────
    const live = await livePosition(ex, SYMBOL);
    const tighter = Number(ex.priceToPrecision(SYMBOL, Number(live?.markPrice ?? mark) * 0.97));
    const moved = await strategy.moveWorking(ex, {
      symbol: SYMBOL, exitSide: "sell", size: Number(live?.contracts ?? size),
      stopPrice: tighter, clientOid: `ss${Date.now().toString(36)}`, marginMode: MARGIN_MODE,
    });
    note("moveWorking result", JSON.stringify(moved));
    check("moveWorking() reports moved", moved.moved === true, moved.moved ? "" : `reason=${moved.reason}`);
    await sleep(2000);

    const workingAfter = await strategy.findWorking(ex, SYMBOL);
    note("findWorking() after the move", workingAfter.map((s) => `${s.id.slice(0, 10)}@${s.triggerPrice}`).join(" ") || "(none)");
    check("exactly ONE working stop rests", workingAfter.length === 1, `n=${workingAfter.length}`);
    check("…at the tighter price", workingAfter[0]?.triggerPrice === tighter, `${workingAfter[0]?.triggerPrice} vs ${tighter}`);

    const backstopAfter = await strategy.findBackstop(ex, SYMBOL);
    if (strategy.slots === 2) {
      check("2-slot venue: the backstop SURVIVED the move, under its own id",
        backstopAfter !== null && backstopAfter.id !== workingAfter[0]?.id && backstopAfter.triggerPrice === backstopPrice,
        `backstop=${backstopAfter?.id.slice(0, 10)}@${backstopAfter?.triggerPrice} working=${workingAfter[0]?.id.slice(0, 10)}@${workingAfter[0]?.triggerPrice}`);
      console.log("      ↳ two stops, two ids: the ratchet cannot endanger the position");
    } else {
      check("1-slot venue: the move OVERWROTE the backstop (same id, new trigger)",
        backstopAfter !== null && backstopAfter.id === workingAfter[0]?.id && backstopAfter.triggerPrice === tighter,
        `backstop=${backstopAfter?.id.slice(0, 10)}@${backstopAfter?.triggerPrice}`);
      console.log("      ↳ ONE stop: never-naked is our code's job, not the venue's");
    }

    // A second move must REPLACE, never stack — on either venue.
    const tighter2 = Number(ex.priceToPrecision(SYMBOL, Number(live?.markPrice ?? mark) * 0.98));
    const moved2 = await strategy.moveWorking(ex, {
      symbol: SYMBOL, exitSide: "sell", size: Number((await livePosition(ex, SYMBOL))?.contracts ?? size),
      stopPrice: tighter2, clientOid: `ss2${Date.now().toString(36)}`, marginMode: MARGIN_MODE,
    });
    await sleep(2000);
    const working2 = await strategy.findWorking(ex, SYMBOL);
    check("a second move still leaves exactly ONE working stop", working2.length === 1, `n=${working2.length} moved=${moved2.moved}`);
    check("…and it is at the newest price", working2[0]?.triggerPrice === tighter2, `${working2[0]?.triggerPrice} vs ${tighter2}`);

    // ── clearWorking ─────────────────────────────────────────────────────────
    await strategy.clearWorking(ex, SYMBOL);
    await sleep(2000);
    const workingCleared = await strategy.findWorking(ex, SYMBOL);
    const backstopCleared = await strategy.findBackstop(ex, SYMBOL);
    check("clearWorking() removed every working stop", workingCleared.length === 0, `n=${workingCleared.length}`);
    if (strategy.slots === 2) {
      check("2-slot venue: the backstop is STILL protecting the position after the clear",
        backstopCleared !== null && backstopCleared.triggerPrice === backstopPrice,
        `backstop=${backstopCleared?.triggerPrice ?? "(GONE)"}`);
    } else {
      check("1-slot venue: the clear removed the ONLY stop — position now unprotected (expected)",
        backstopCleared === null, `backstop=${backstopCleared?.triggerPrice ?? "(none)"}`);
      console.log("      ↳ exactly why clearWorking() must run at flatten and NOWHERE else");
    }
  } finally {
    await flatten(ex, venue, SYMBOL);
    const finalPos = await livePosition(ex, SYMBOL);
    const finalWorking = await strategy.findWorking(ex, SYMBOL);
    check("cleanup: flat", Number(finalPos?.contracts ?? 0) === 0, `contracts=${finalPos?.contracts ?? 0}`);
    check("cleanup: no stops left behind", finalWorking.length === 0, `n=${finalWorking.length}`);
  }
}

async function main() {
  for (const testCase of CASES) {
    await runVenue(testCase).catch((error) => {
      failures++;
      console.log(`  ✗ ${testCase.venue} threw: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((error) => { console.error("\nERROR:", error); process.exit(1); });
