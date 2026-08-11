// The four Bybit questions that source cannot answer — settled with real orders on the
// DEMO engine. This is the crux of the port: the answers decide whether the stop ladder's
// safety model survives translation, or has to be redesigned.
//
//   1. Is the entry-attached stop genuinely SIZELESS and self-clamping? (never-naked)
//   2. Does reduce-only STARVATION reproduce on Bybit? (the P0 that hid for a year)
//   3. Can the movable stop be identified, modified in place, and CLEARED?
//   4. Does a Full-mode stop appear in the order list at all? (enumerate-stops survives?)
//
// ⚠ THIS PLACES REAL ORDERS on api-demo.bybit.com and CHANGES DEMO ACCOUNT SETTINGS.
//   Never live: it refuses to run unless enableDemoTrading put us on the demo host.
//   It flips the DEMO account to ISOLATED margin — account-wide on UTA, deliberately,
//   because that is what the engine does and the tests must match production intent.
//   Cleanup flattens the position and cancels everything, in a finally block.
//
//   npx tsx scripts/probe-bybit-stops.ts
import "dotenv/config";
import ccxt, { type Exchange, type Order } from "ccxt";

const SYMBOL = "BTC/USDT:USDT";
const LEVERAGE = 5;
const SIZE = 0.010;      // 10x the 0.001 min, so rungs of 0.002-0.004 all clear it
const RUNG = 0.003;      // the "rung" we force-fill to test clamping
const STOP_PCT = 0.10;   // the attached backstop, far away and out of the way

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const open = (label: string) => console.log(`  ? ${label}  ← OPEN QUESTION, recording only`);
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The params that route createOrder to POST /v5/position/trading-stop — the sizeless,
 * position-level stop that is Bitget's `pos_loss` analogue. `tradingStopEndpoint` is the
 * switch; `amount: 0` is what selects tpslMode Full over Partial.
 */
const tradingStopParams = (stopLossPrice: number, clientOrderId?: string): Record<string, unknown> => ({
  stopLossPrice,
  tradingStopEndpoint: true,
  ...(clientOrderId ? { clientOrderId } : {}),
});

type RawPosition = { stopLoss?: string; tpslMode?: string; positionIdx?: number; size?: string };

/** The venue's own view of the position, including the raw TP/SL fields ccxt does not unify. */
async function readPosition(ex: Exchange) {
  const positions = await ex.fetchPositions([SYMBOL]);
  const marketId = ex.markets[SYMBOL]?.id;
  const mine = positions.find((p) => (p.info as { symbol?: string })?.symbol === marketId);
  const info = (mine?.info ?? {}) as RawPosition;
  return {
    contracts: Number(mine?.contracts ?? 0),
    markPrice: Number(mine?.markPrice ?? 0),
    stopLoss: (info.stopLoss ?? "").trim(),
    tpslMode: info.tpslMode ?? "",
    positionIdx: info.positionIdx,
    raw: info,
  };
}

/** Every resting order, split by whether it took the StopOrder filter to see. */
async function readOrders(ex: Exchange) {
  const asNormal: Order[] = await ex.fetchOpenOrders(SYMBOL).catch(() => []);
  const asStop: Order[] = await ex.fetchOpenOrders(SYMBOL, undefined, undefined, { trigger: true }).catch(() => []);
  const describe = (orders: Order[]) =>
    orders.map((o) => {
      const info = o.info as { stopOrderType?: string; orderLinkId?: string; triggerPrice?: string };
      return `${o.id?.slice(0, 8)}|${o.side}|${o.amount}|stopOrderType=${info.stopOrderType || "-"}|trig=${info.triggerPrice || "-"}`;
    });
  return { asNormal, asStop, describeNormal: describe(asNormal), describeStop: describe(asStop) };
}

/** Sweep the venue clean: every family of resting order, then flatten, then clear the stop. */
async function cleanup(ex: Exchange) {
  for (const params of [{}, { trigger: true }]) {
    await ex.cancelAllOrders(SYMBOL, params).catch(() => {});
  }
  // Clear any Full-mode position stop. ccxt cannot express this (priceToPrecision rejects
  // 0), so it must go out as the raw implicit call.
  await rawTradingStop(ex, "0").catch(() => {});
  const position = await readPosition(ex);
  if (position.contracts > 0) {
    await ex
      .createOrder(SYMBOL, "market", "sell", position.contracts, undefined, { reduceOnly: true })
      .catch((e) => console.log(`    flatten failed: ${e instanceof Error ? e.message : e}`));
  }
}

/** The engine primitive ccxt is missing: set or clear a Full-mode position stop. */
function rawTradingStop(ex: Exchange, stopLoss: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ex as any).privatePostV5PositionTradingStop({
    category: "linear",
    symbol: ex.markets[SYMBOL].id,
    stopLoss,
    tpslMode: "Full",
    positionIdx: 0,
  });
}

async function main() {
  const key = process.env.BYBIT_DEMO_KEY?.trim();
  const secret = process.env.BYBIT_DEMO_SECRET?.trim();
  if (!key || !secret) throw new Error("BYBIT_DEMO_KEY / BYBIT_DEMO_SECRET missing from .env");

  const ex = new ccxt.bybit({
    apiKey: key, secret,
    enableRateLimit: true, timeout: 20_000,
    options: { defaultType: "swap", defaultSubType: "linear" },
  });
  ex.enableDemoTrading(true);
  ex.has["fetchCurrencies"] = false;

  // Hard safety interlock: refuse to place a single order unless we are on the demo host.
  if (!JSON.stringify(ex.urls.api).includes("api-demo")) {
    throw new Error("REFUSING TO RUN — not on the demo host");
  }
  await ex.loadMarkets();
  const round = (n: number) => Number(ex.amountToPrecision(SYMBOL, n));
  const price = (n: number) => Number(ex.priceToPrecision(SYMBOL, n));

  console.log(`ccxt ${ccxt.version} · api-demo · ${SYMBOL}\n`);

  try {
    // ── prep, exactly as the engine would ────────────────────────────────────
    console.log("── prep (and does setMarginMode work with Orders+Positions scopes?) ──");
    await ex.setPositionMode(false, SYMBOL).then(
      () => check("setPositionMode(one-way)", true),
      (e) => check("setPositionMode(one-way)", /110025|not modified/i.test(String(e)), `${e}`.slice(0, 90)),
    );
    await ex.setMarginMode("isolated", SYMBOL).then(
      () => check("setMarginMode(isolated) — ACCOUNT-WIDE on UTA", true),
      (e) => check("setMarginMode(isolated)", /110026|already/i.test(String(e)), `${e}`.slice(0, 120)),
    );
    await ex.setLeverage(LEVERAGE, SYMBOL).then(
      () => check(`setLeverage(${LEVERAGE})`, true),
      (e) => check(`setLeverage(${LEVERAGE})`, /110043|not modified/i.test(String(e)), `${e}`.slice(0, 90)),
    );
    // The idempotence trap: a no-op leverage repeat is an ERROR on Bybit, not a no-change.
    const repeat = await ex.setLeverage(LEVERAGE, SYMBOL).then(() => "accepted", (e) => String(e).slice(0, 60));
    note("setLeverage repeated (110043 expected)", repeat);

    const ticker = await ex.fetchTicker(SYMBOL);
    const mark = Number(ticker.last);
    note("mark", mark);

    // ══ TEST 1 — is the attached stop SIZELESS and SELF-CLAMPING? ═══════════════
    console.log("\n══ TEST 1 · attached stop: sizeless, and does it clamp? ══");
    const backstop = price(mark * (1 - STOP_PCT));
    const entry = await ex.createOrder(SYMBOL, "market", "buy", round(SIZE), undefined, {
      clientOrderId: `p1e${Date.now().toString(36)}`,
      stopLoss: { triggerPrice: backstop },
    });
    check("entry filled with an attached stop", Boolean(entry.id), `id=${entry.id?.slice(0, 10)} stop=${backstop}`);
    await sleep(1500);

    let position = await readPosition(ex);
    note("contracts", position.contracts);
    note("info.stopLoss", position.stopLoss || "(empty)");
    note("info.tpslMode", position.tpslMode || "(empty)");
    note("info.positionIdx", position.positionIdx);
    check("the stop landed on the POSITION, not as an order", position.stopLoss !== "", `stopLoss=${position.stopLoss}`);
    check("tpslMode is Full (⇒ sizeless, covers the whole position)", position.tpslMode === "Full", position.tpslMode);

    const beforeClamp = { contracts: position.contracts, stopLoss: position.stopLoss };
    // Force a rung to fill NOW: a reduce-only sell priced through the bid is a taker fill.
    const fill = await ex.createOrder(SYMBOL, "limit", "sell", round(RUNG), price(mark * 0.999), {
      reduceOnly: true, clientOrderId: `p1r${Date.now().toString(36)}`,
    });
    check("a reduce-only rung filled (position shrinks)", Boolean(fill.id));
    await sleep(2500);

    position = await readPosition(ex);
    note("contracts after the rung", `${beforeClamp.contracts} → ${position.contracts}`);
    note("info.stopLoss after the rung", position.stopLoss || "(empty)");
    check("position actually shrank", position.contracts < beforeClamp.contracts, `${position.contracts}`);
    check(
      "THE ANSWER: stop survived the partial close, unchanged and still whole-position",
      position.stopLoss === beforeClamp.stopLoss && position.stopLoss !== "" && position.tpslMode === "Full",
      `stopLoss=${position.stopLoss || "(GONE)"} tpslMode=${position.tpslMode}`,
    );
    console.log("      ↳ if this passes, Bybit's sizeless Full stop IS a valid never-naked");
    console.log("        backstop — by being sizeless rather than by clamping like Bitget's.");

    // ══ TEST 4 (before 3, while a Full stop is live) ════════════════════════════
    console.log("\n══ TEST 4 · does a Full-mode stop appear in the ORDER list? ══");
    let orders = await readOrders(ex);
    note("fetchOpenOrders() plain", orders.describeNormal.length ? orders.describeNormal.join("  ") : "(none)");
    note("fetchOpenOrders({trigger:true})", orders.describeStop.length ? orders.describeStop.join("  ") : "(none)");
    const fullStopVisible = orders.asStop.length > 0;
    open(`Full-mode stop enumerable as an order? → ${fullStopVisible ? "YES" : "NO"}`);
    console.log(
      fullStopVisible
        ? "      ↳ enumerate-stops can stay ORDER-BASED; filter info.stopOrderType as the planType analogue"
        : "      ↳ enumerate-stops MUST be rewritten to read fetchPositions().info.stopLoss —\n" +
          "        there is no order to find, so the ratchet's cancel-first step has no target",
    );

    // ══ TEST 3 — identity, modify-in-place, and CLEAR ══════════════════════════
    console.log("\n══ TEST 3 · movable stop: identity, modify-in-place, clear ══");
    position = await readPosition(ex);
    const stop1 = price(position.markPrice * 0.97);
    const stop2 = price(position.markPrice * 0.98); // tighter — the ratchet direction

    const mint = await ex
      .createOrder(SYMBOL, "market", "sell", 0, undefined, tradingStopParams(stop1, `p3a${Date.now().toString(36)}`))
      .catch((e) => ({ id: undefined, err: String(e).slice(0, 120) }) as unknown as Order);
    note("mint returned id", (mint as Order).id ?? "(none — as predicted)");
    note("mint returned clientOrderId", (mint as Order).clientOrderId ?? "(none — dropped by ccxt)");
    await sleep(1500);
    position = await readPosition(ex);
    check("stop 1 is on the position", position.stopLoss === String(stop1), `${position.stopLoss} vs ${stop1}`);

    await ex
      .createOrder(SYMBOL, "market", "sell", 0, undefined, tradingStopParams(stop2))
      .catch((e) => console.log(`    stop 2 rejected: ${String(e).slice(0, 120)}`));
    await sleep(1500);
    position = await readPosition(ex);
    check(
      "THE ANSWER: a second stop REPLACED the first in place (not stacked)",
      position.stopLoss === String(stop2),
      `stopLoss=${position.stopLoss} (expected ${stop2}, was ${stop1})`,
    );
    orders = await readOrders(ex);
    note("resting stop-orders now", orders.describeStop.length ? orders.describeStop.join("  ") : "(none)");

    // The clear — the primitive ccxt cannot express.
    const cleared = await rawTradingStop(ex, "0").then(() => "ok", (e: unknown) => String(e).slice(0, 120));
    note("raw trading-stop clear", cleared);
    await sleep(1500);
    position = await readPosition(ex);
    check("THE ANSWER: the raw call CLEARS the stop", position.stopLoss === "", `stopLoss=${position.stopLoss || "(empty)"}`);
    console.log("      ↳ this is why privatePostV5PositionTradingStop must be a first-class");
    console.log("        engine primitive — the ratchet cannot function without a clear");

    // ══ TEST 2 — does STARVATION reproduce? ════════════════════════════════════
    console.log("\n══ TEST 2 · reduce-only starvation: does Bitget's P0 reproduce? ══");
    position = await readPosition(ex);
    const remaining = round(position.contracts);
    note("remaining contracts", remaining);

    if (remaining < 0.003) {
      open("SKIPPED — not enough left to split into a ladder plus a sized stop");
    } else {
      // A full-size reduce-only ladder resting well ABOVE the market: it reserves the
      // whole position without filling. This is the exact condition that starves a
      // reduce-only stop on Bitget.
      const legs = [round(remaining * 0.5), round(remaining - round(remaining * 0.5))];
      const ladder = await ex.createOrders(
        legs.map((amount, i) => ({
          symbol: SYMBOL, type: "limit" as const, side: "sell" as const, amount,
          price: price(position.markPrice * (1.05 + i * 0.01)),
          params: { reduceOnly: true, clientOrderId: `p2t${i}${Date.now().toString(36)}` },
        })),
      );
      const placed = ladder.filter((o) => o.status !== "rejected" && o.id);
      check("full-size reduce-only ladder is resting", placed.length === legs.length, `${placed.length}/${legs.length}`);
      for (const leg of ladder) {
        if (leg.status === "rejected" || !leg.id) note("REJECTED leg", JSON.stringify(leg.info).slice(0, 160));
      }

      // Now a PARTIAL (sized) stop for the whole remainder, just below the mark so a
      // normal tick triggers it. If it fills 0, Bybit reserves size like Bitget does.
      const fresh = await readPosition(ex);
      const trigger = price(fresh.markPrice * 0.9993);
      const sized = await ex
        .createOrder(SYMBOL, "market", "sell", remaining, undefined, tradingStopParams(trigger))
        .then(() => "accepted", (e) => String(e).slice(0, 140));
      note("sized (Partial) stop", sized);
      const armed = await readPosition(ex);
      note("info.tpslMode", armed.tpslMode);
      note("info.stopLoss / trigger", `${armed.stopLoss} (mark ${armed.markPrice})`);

      if (armed.stopLoss === "") {
        open("INCONCLUSIVE — the sized stop never armed; cannot test starvation");
      } else {
        console.log(`  … waiting up to 150s for the mark to cross ${trigger} …`);
        let fired = false;
        for (let i = 0; i < 30; i++) {
          await sleep(5000);
          const now = await readPosition(ex);
          if (now.contracts === 0 || now.stopLoss === "") { fired = true; break; }
          if (i % 4 === 3) note(`  t+${(i + 1) * 5}s`, `mark=${now.markPrice} contracts=${now.contracts}`);
        }
        const after = await readPosition(ex);
        if (!fired && after.contracts > 0) {
          open(`INCONCLUSIVE — mark never crossed ${trigger} in 150s (contracts still ${after.contracts})`);
          console.log("      ↳ re-run in a livelier market, or widen the trigger gap");
        } else {
          check(
            "THE ANSWER: the sized stop CLOSED the position despite the reduce-only ladder",
            after.contracts === 0,
            `contracts=${after.contracts}`,
          );
          console.log(after.contracts === 0
            ? "      ↳ NO starvation on Bybit — a sized (Partial) stop is usable"
            : "      ↳ STARVATION REPRODUCES — sized stops are unusable; Full/sizeless ONLY");
        }
      }
    }
  } finally {
    console.log("\n── cleanup ──");
    await cleanup(ex);
    await sleep(2000);
    const final = await readPosition(ex);
    const rest = await readOrders(ex);
    check("flat", final.contracts === 0, `contracts=${final.contracts}`);
    check("no resting orders", rest.asNormal.length === 0 && rest.asStop.length === 0, `n=${rest.asNormal.length}+${rest.asStop.length}`);
    check("no position stop left behind", final.stopLoss === "", final.stopLoss || "(empty)");
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((error) => {
    console.error("\nERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
