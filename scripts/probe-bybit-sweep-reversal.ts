// The last three Bybit unknowns, all of which change the stop-ladder design.
//
//   A. Does a BARE cancelAllOrders(symbol) sweep the Full-mode backstop?
//      The Full stop appears in PLAIN fetchOpenOrders(), not only under {trigger:true}.
//      closeAll() and the settle path both call cancelAllOrders with no params, so if that
//      kills the stop, those sweeps have to be reordered or narrowed.
//
//   B. STARVATION, two-arm. A sized (Partial) stop was "accepted" but never armed while a
//      full-size reduce-only ladder rested. Arm 1 sets it with NO ladder, arm 2 WITH one, so
//      the ladder is the only variable. Distinguishes "sized stops are broken" from "the
//      ladder's reservation blocks them" — Bitget's starvation, at arm time instead of trigger.
//
//   C. REVERSAL. The bots are swing: a new entry REPLACES the position (dispatch.ts:177). If
//      the old stop is inherited by the flipped position it is now on the WRONG SIDE and at a
//      dead trigger — the exact hazard closeAll() guards on Bitget. Wiped / inherited / stale?
//
// ⚠ Places real orders on api-demo.bybit.com. Refuses to run off the demo host. Cleans up
//   after every section and again in a finally block.
//
//   npx tsx scripts/probe-bybit-sweep-reversal.ts
import "dotenv/config";
import ccxt, { type Exchange, type Order } from "ccxt";

const SYMBOL = "BTC/USDT:USDT";
const LEVERAGE = 5;
const SIZE = 0.005;

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const answer = (label: string, value: string) => console.log(`  ★ ${label}: ${value}`);
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tradingStopParams = (stopLossPrice: number): Record<string, unknown> => ({
  stopLossPrice,
  tradingStopEndpoint: true,
});

type RawPosition = { stopLoss?: string; tpslMode?: string; side?: string };

async function readPosition(ex: Exchange) {
  const marketId = ex.markets[SYMBOL]?.id;
  const positions = await ex.fetchPositions([SYMBOL]);
  const mine = positions.find((p) => (p.info as { symbol?: string })?.symbol === marketId);
  const info = (mine?.info ?? {}) as RawPosition;
  return {
    contracts: Number(mine?.contracts ?? 0),
    side: mine?.side ?? info.side ?? "",
    markPrice: Number(mine?.markPrice ?? 0),
    stopLoss: (info.stopLoss ?? "").trim(),
    tpslMode: info.tpslMode ?? "",
  };
}

async function restingOrders(ex: Exchange) {
  const plain: Order[] = await ex.fetchOpenOrders(SYMBOL).catch(() => []);
  const trig: Order[] = await ex.fetchOpenOrders(SYMBOL, undefined, undefined, { trigger: true }).catch(() => []);
  const fmt = (o: Order) => {
    const i = o.info as { stopOrderType?: string; triggerPrice?: string };
    return `${o.id?.slice(0, 8)}|${o.side}|${o.amount}|type=${i.stopOrderType || "limit"}|trig=${i.triggerPrice || "-"}`;
  };
  return { plain, trig, plainDesc: plain.map(fmt), trigDesc: trig.map(fmt) };
}

function rawTradingStop(ex: Exchange, stopLoss: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ex as any).privatePostV5PositionTradingStop({
    category: "linear", symbol: ex.markets[SYMBOL].id, stopLoss, tpslMode: "Full", positionIdx: 0,
  });
}

async function flatten(ex: Exchange) {
  for (const params of [{ trigger: true }, {}]) await ex.cancelAllOrders(SYMBOL, params).catch(() => {});
  await rawTradingStop(ex, "0").catch(() => {});
  const p = await readPosition(ex);
  if (p.contracts > 0) {
    await ex
      .createOrder(SYMBOL, "market", p.side === "long" ? "sell" : "buy", p.contracts, undefined, { reduceOnly: true })
      .catch((e) => console.log(`    flatten failed: ${String(e).slice(0, 100)}`));
  }
  await sleep(1800);
}

/** Open a long with the entry-attached backstop, exactly as openPosition() does. */
async function openWithBackstop(ex: Exchange, size: number, stopPct = 0.10) {
  const mark = Number((await ex.fetchTicker(SYMBOL)).last);
  const stop = Number(ex.priceToPrecision(SYMBOL, mark * (1 - stopPct)));
  await ex.createOrder(SYMBOL, "market", "buy", Number(ex.amountToPrecision(SYMBOL, size)), undefined, {
    clientOrderId: `sr${Date.now().toString(36)}`,
    stopLoss: { triggerPrice: stop },
  });
  await sleep(1800);
  return { mark, stop };
}

async function main() {
  const key = process.env.BYBIT_DEMO_KEY?.trim();
  const secret = process.env.BYBIT_DEMO_SECRET?.trim();
  if (!key || !secret) throw new Error("BYBIT_DEMO_KEY / BYBIT_DEMO_SECRET missing from .env");

  const ex = new ccxt.bybit({
    apiKey: key, secret, enableRateLimit: true, timeout: 20_000,
    options: { defaultType: "swap", defaultSubType: "linear" },
  });
  ex.enableDemoTrading(true);
  ex.has["fetchCurrencies"] = false;
  if (!JSON.stringify(ex.urls.api).includes("api-demo")) throw new Error("REFUSING TO RUN — not on the demo host");
  await ex.loadMarkets();
  const price = (n: number) => Number(ex.priceToPrecision(SYMBOL, n));
  const round = (n: number) => Number(ex.amountToPrecision(SYMBOL, n));

  console.log(`ccxt ${ccxt.version} · api-demo · ${SYMBOL}\n`);
  await ex.setLeverage(LEVERAGE, SYMBOL).catch(() => {});

  try {
    // ══ A · does a BARE cancelAllOrders sweep the backstop? ═════════════════════
    console.log("══ A · does bare cancelAllOrders(symbol) kill the Full-mode stop? ══");
    await flatten(ex);
    const { stop } = await openWithBackstop(ex, SIZE);
    let position = await readPosition(ex);
    check("long open with the attached stop", position.contracts > 0 && position.stopLoss !== "", `${position.contracts} @ stop ${position.stopLoss}`);

    // A resting TP that will not fill — the thing a legitimate sweep is meant to remove.
    await ex.createOrder(SYMBOL, "limit", "sell", round(SIZE), price(position.markPrice * 1.08), {
      reduceOnly: true, clientOrderId: `sa${Date.now().toString(36)}`,
    });
    await sleep(1500);
    let orders = await restingOrders(ex);
    note("plain fetchOpenOrders", orders.plainDesc.join("  ") || "(none)");
    check("the Full stop is visible in the PLAIN list (not just {trigger:true})",
      orders.plain.some((o) => (o.info as { stopOrderType?: string })?.stopOrderType === "StopLoss"),
      `plain=${orders.plain.length} trig=${orders.trig.length}`);

    await ex.cancelAllOrders(SYMBOL).catch((e) => note("cancelAllOrders threw", String(e).slice(0, 90)));
    await sleep(2000);
    position = await readPosition(ex);
    orders = await restingOrders(ex);
    note("after the bare sweep — position.stopLoss", position.stopLoss || "(EMPTY)");
    note("after the bare sweep — resting", orders.plainDesc.join("  ") || "(none)");
    const stopSurvived = position.stopLoss === String(stop);
    answer("A", stopSurvived
      ? "SAFE — a bare cancelAllOrders removes limits but LEAVES the position stop"
      : "DANGEROUS — a bare cancelAllOrders WIPED the backstop; the position is naked");
    check("position still open (so this is a real naked-vs-not verdict)", position.contracts > 0, `${position.contracts}`);
    console.log(stopSurvived
      ? "      ↳ closeAll() and the settle sweep can keep calling it unchanged"
      : "      ↳ closeAll() must NOT bare-sweep before the market close, and the settle path\n" +
        "        must re-arm or reorder — otherwise every stop-out sweep strips protection");

    // ══ B · STARVATION, two-arm ════════════════════════════════════════════════
    console.log("\n══ B · starvation: sized (Partial) stop, with vs without a ladder ══");
    await flatten(ex);
    await openWithBackstop(ex, SIZE);
    position = await readPosition(ex);
    // Clear the Full stop so the slot is empty and only the sized attempt occupies it.
    await rawTradingStop(ex, "0").catch(() => {});
    await sleep(1200);

    // ARM 1 — no ladder resting.
    const t1 = price(position.markPrice * 0.95);
    const r1 = await ex
      .createOrder(SYMBOL, "market", "sell", round(SIZE), undefined, tradingStopParams(t1))
      .then((o) => JSON.stringify(o.info).slice(0, 120), (e) => `THREW ${String(e).slice(0, 120)}`);
    await sleep(1800);
    let after = await readPosition(ex);
    const arm1Armed = after.stopLoss !== "";
    note("arm 1 response", r1);
    note("arm 1 → stopLoss / tpslMode", `${after.stopLoss || "(empty)"} / ${after.tpslMode}`);
    // Recorded, not asserted: "a sized stop does not arm" is the ANSWER, not a failure. Note
    // the response is an empty `{}` with NO error — retCode 0 and no effect. That silent
    // no-op is the real hazard: the engine would believe it had placed a stop.
    note("ARM 1 (no ladder) armed?", arm1Armed ? "yes" : "NO — silent no-op, empty result, no error");

    // ARM 2 — same call, but with a full-size reduce-only ladder reserving the position.
    await rawTradingStop(ex, "0").catch(() => {});
    await sleep(1200);
    const legs = [round(SIZE * 0.5), round(SIZE - round(SIZE * 0.5))];
    const ladder = await ex.createOrders(
      legs.map((amount, i) => ({
        symbol: SYMBOL, type: "limit" as const, side: "sell" as const, amount,
        price: price(after.markPrice * (1.06 + i * 0.01)),
        params: { reduceOnly: true, clientOrderId: `sb${i}${Date.now().toString(36)}` },
      })),
    );
    check("full-size reduce-only ladder resting", ladder.filter((o) => o.id && o.status !== "rejected").length === legs.length,
      `${ladder.filter((o) => o.id).length}/${legs.length}`);
    await sleep(1500);

    const t2 = price(after.markPrice * 0.95);
    const r2 = await ex
      .createOrder(SYMBOL, "market", "sell", round(SIZE), undefined, tradingStopParams(t2))
      .then((o) => JSON.stringify(o.info).slice(0, 120), (e) => `THREW ${String(e).slice(0, 120)}`);
    await sleep(1800);
    after = await readPosition(ex);
    const arm2Armed = after.stopLoss !== "";
    note("arm 2 response", r2);
    note("arm 2 → stopLoss / tpslMode", `${after.stopLoss || "(empty)"} / ${after.tpslMode}`);

    answer("B", arm1Armed && !arm2Armed
      ? "STARVATION CONFIRMED, at ARM time — a sized stop arms alone but NOT behind a full ladder"
      : arm1Armed && arm2Armed
        ? "NO starvation — a sized stop arms even behind a full reduce-only ladder"
        : !arm1Armed
          ? "SIZED STOPS DO NOT ARM AT ALL via this path (ladder is irrelevant) — use Full only"
          : "unexpected combination; read the two responses above");
    console.log("      ↳ either way the engine uses Full/sizeless, which is already proven.");
    console.log("        This only settles WHY, and whether a sized stop is ever an option.");

    // ══ C · REVERSAL — what happens to the stop when the position flips? ════════
    console.log("\n══ C · reversal: is the stop wiped, inherited, or left stale? ══");
    await flatten(ex);
    const opened = await openWithBackstop(ex, SIZE);
    position = await readPosition(ex);
    check("long open with a backstop below the mark", position.contracts > 0 && position.stopLoss !== "",
      `${position.side} ${position.contracts} @ stop ${position.stopLoss}`);
    note("long-side stop trigger", opened.stop);

    // One-way mode: a sell of GREATER size should net out and flip to short. No reduceOnly —
    // that is the whole point, and it is what a Bitget REVERSAL does after flattening.
    const flip = await ex
      .createOrder(SYMBOL, "market", "sell", round(SIZE * 2), undefined, { clientOrderId: `sc${Date.now().toString(36)}` })
      .then(() => "accepted", (e) => `REJECTED ${String(e).slice(0, 140)}`);
    note("oversized opposite market order", flip);
    await sleep(2500);
    const flipped = await readPosition(ex);
    const orders2 = await restingOrders(ex);
    note("position after", `${flipped.side || "(flat)"} ${flipped.contracts}`);
    note("stopLoss after", flipped.stopLoss || "(EMPTY)");
    note("tpslMode after", flipped.tpslMode || "(none)");
    note("resting", orders2.plainDesc.join("  ") || "(none)");

    if (flip.startsWith("REJECTED")) {
      answer("C", "Bybit REFUSES an oversized opposite order — the engine must flatten first, exactly as it does on Bitget");
    } else if (flipped.contracts === 0) {
      answer("C", "the opposite order CLOSED the position without flipping (net to flat)");
    } else if (flipped.side === "short" && flipped.stopLoss === "") {
      answer("C", "SAFE — the flip WIPED the old stop; the new short opens unprotected and must be re-armed immediately");
    } else if (flipped.side === "short" && flipped.stopLoss !== "") {
      const stale = Number(flipped.stopLoss) < flipped.markPrice;
      answer("C", stale
        ? `DANGEROUS — the old LONG stop (${flipped.stopLoss}) was INHERITED by the new SHORT, below the mark (${flipped.markPrice}). Wrong side, dead trigger.`
        : `the flip left a stop at ${flipped.stopLoss} above the mark — check whether Bybit re-derived it for the short`);
    } else {
      answer("C", `unexpected: side=${flipped.side} contracts=${flipped.contracts} stopLoss=${flipped.stopLoss || "(empty)"}`);
    }
    console.log("      ↳ decides whether the Bybit reversal path can reuse dispatch.ts's");
    console.log("        flatten-then-open, or needs a re-arm step wired in immediately after.");
  } finally {
    console.log("\n── cleanup ──");
    await flatten(ex);
    await sleep(1500);
    const final = await readPosition(ex);
    const rest = await restingOrders(ex);
    check("flat", final.contracts === 0, `contracts=${final.contracts}`);
    check("no resting orders", rest.plain.length === 0 && rest.trig.length === 0, `n=${rest.plain.length}+${rest.trig.length}`);
    check("no stop left behind", final.stopLoss === "", final.stopLoss || "(empty)");
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((error) => {
    console.error("\nERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
