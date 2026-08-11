/**
 * How a FIRED Bybit stop is attributed — the last unproven link in the Bybit port.
 *
 * WHY THIS MATTERS MORE THAN A LABEL. When a position settles, manage.ts matches the closing
 * fills to orders it recorded. If it cannot, `realizedPnlFor` WIDENS to every fill on the
 * symbol in the position's lifetime and logs `pnl.attributionIncomplete`. On an account where
 * the member also trades by hand, that widening pulls THEIR fills into the bot's PnL — and that
 * number is what `realizedBalance` compounds from and sizes the next trade with. So unattributed
 * stop-outs are not a cosmetic `closedReason` problem; they are a wrong-number risk.
 *
 * On Bitget the link is known and proven: a triggered plan order executes via a CHILD market
 * order whose `clientOid` IS the plan-order id (verify-preset-demo confirms it —
 * fill 1468452240737009665 carried clientOid 1468451588749672448 = the plan id).
 *
 * On Bybit nothing is proven. Two shapes are possible and they need opposite handling:
 *   SAME-ID   — the stop order transitions Untriggered → Triggered → Filled on one id, so the
 *               fill carries the id we already hold and no extra work is needed.
 *   NO PARENT — a Full-mode position stop is an attribute, so the fill may carry a brand-new
 *               order id with nothing linking back except raw fields (`createType`,
 *               `stopOrderType`), which ccxt never reads.
 *
 * This places a real demo position with the stop a few basis points under the mark and waits for
 * the market to take it out, then dumps every identifier on the closing fill so manage.ts can be
 * taught the right rule. Market-timing dependent by nature: reports INCONCLUSIVE rather than
 * failing if the mark never reaches the trigger.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/probe-bybit-stopout-attribution.ts
 */
import "dotenv/config";
import type { Exchange } from "ccxt";
import { adapterFor, exchangeClient, getMarket, livePosition, type TradeCreds } from "../lib/execution/client";
import { stopStrategyFor } from "../lib/execution/stops";

const VENUE = "Bybit";
const SYMBOL = "BTC/USDT:USDT";
const LEVERAGE = 5;
const SIZE_MULTIPLE = 3; // 0.003 — above the 0.001 minimum, small enough to be cheap

/**
 * Firing a stop on demand, without waiting on luck.
 *
 * A stop only triggers when the mark crosses it, and a wrong-side trigger is rejected outright
 * (110092/110093) — so we cannot simply place one where the price has already been. The first
 * attempt at this waited 4 minutes for a LONG's stop while the market drifted steadily UP, and
 * learned nothing.
 *
 * So: ALTERNATE SIDES with a tight gap. A long's stop sits below the mark and a short's sits
 * above it, so whichever way the market is actually moving takes one of them out. Each attempt
 * gets a short window, and the gap is small enough (~0.015%, roughly $10 on BTC) that any
 * ordinary tick crosses it.
 */
const TRIGGER_GAP = 0.00015;
const ATTEMPT_MS = 75_000;
const ATTEMPTS: ("LONG" | "SHORT")[] = ["LONG", "SHORT", "LONG", "SHORT"];

const creds: TradeCreds = {
  apiKey: process.env.BYBIT_DEMO_KEY ?? "",
  apiSecret: process.env.BYBIT_DEMO_SECRET ?? "",
  sandbox: true,
};

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);
const answer = (label: string, value: string) => console.log(`  ★ ${label}: ${value}`);
const inconclusive = (why: string) => console.log(`  ~ INCONCLUSIVE — ${why}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function flatten(ex: Exchange) {
  const strategy = stopStrategyFor(VENUE);
  const live = await livePosition(ex, SYMBOL);
  const contracts = Number(live?.contracts ?? 0);
  if (contracts > 0) {
    await ex.createOrder(SYMBOL, "market", live?.side === "long" ? "sell" : "buy", contracts, undefined, { reduceOnly: true }).catch(() => {});
    await sleep(1500);
  }
  for (const params of [{ trigger: true }, {}]) await ex.cancelAllOrders(SYMBOL, params).catch(() => {});
  await strategy.clearWorking(ex, SYMBOL).catch(() => {});
  await sleep(1200);
}

async function main() {
  if (!creds.apiKey || !creds.apiSecret) throw new Error("BYBIT_DEMO_KEY / BYBIT_DEMO_SECRET missing from .env");
  const adapter = adapterFor(VENUE);
  const strategy = stopStrategyFor(VENUE);

  const market = await getMarket(VENUE, SYMBOL, true);
  if (!market) throw new Error(`demo does not list ${SYMBOL}`);
  const ex = await exchangeClient(VENUE, creds, [market]);
  if (!JSON.stringify(ex.urls.api).includes("api-demo")) throw new Error("REFUSING TO RUN: not on api-demo");
  console.log(`api-demo · ${SYMBOL}\n`);

  await flatten(ex);
  await ex.setPositionMode(false, SYMBOL).catch(() => {});
  await ex.setLeverage(LEVERAGE, SYMBOL).catch(() => {});

  const minAmount = Number(market.limits?.amount?.min ?? 0.001);
  const size = Number(ex.amountToPrecision(SYMBOL, minAmount * SIZE_MULTIPLE));
  const startedAt = Date.now();

  let stopId: string | null = null;
  let exitSide: "buy" | "sell" = "sell";
  let fired = false;

  try {
    for (const side of ATTEMPTS) {
      const isLong = side === "LONG";
      exitSide = isLong ? "sell" : "buy";
      const mark0 = Number((await ex.fetchTicker(SYMBOL)).last);
      // A long's stop sits BELOW the mark, a short's ABOVE it.
      const trigger = Number(ex.priceToPrecision(SYMBOL, mark0 * (isLong ? 1 - TRIGGER_GAP : 1 + TRIGGER_GAP)));
      console.log(`\n── attempt: ${side}, stop ${isLong ? "under" : "over"} the mark ──`);
      note("size / mark / trigger", `${size} / ${mark0} / ${trigger}`);

      const entry = await ex
        .createOrder(SYMBOL, "market", isLong ? "buy" : "sell", size, undefined, {
          ...adapter.orderParams("isolated"),
          clientOrderId: `att${Date.now().toString(36)}`,
          ...strategy.entryStopParams(trigger),
        })
        .catch((e) => { console.log(`  entry rejected: ${String(e).slice(0, 110)}`); return null; });
      if (!entry?.id) { await flatten(ex); continue; }
      await sleep(2500);

      const stops = await strategy.findWorking(ex, SYMBOL);
      stopId = stops[0]?.id ?? null;
      const posBefore = await livePosition(ex, SYMBOL);
      note("stop id / position / venue stopLoss", `${stopId ?? "(none)"} / ${posBefore?.contracts} / ${(posBefore?.info as { stopLoss?: string })?.stopLoss || "(EMPTY)"}`);
      if (!stopId || !(posBefore?.info as { stopLoss?: string })?.stopLoss) {
        // A gap this tight can be refused as too close to the mark — that is itself worth
        // recording, and it means this attempt cannot answer anything.
        console.log("  the stop did not arm at this gap; flattening and trying the other side");
        await flatten(ex);
        continue;
      }

      const deadline = Date.now() + ATTEMPT_MS;
      while (Date.now() < deadline) {
        await sleep(4000);
        const live = await livePosition(ex, SYMBOL);
        if (Number(live?.contracts ?? 0) === 0) { fired = true; break; }
      }
      if (fired) break;
      note("not taken out in this window", `${ATTEMPT_MS / 1000}s — flattening and switching side`);
      await flatten(ex);
    }

    if (!fired) {
      inconclusive("no attempt was stopped out — the market sat inside every trigger. Re-run.");
      return;
    }

    // ── dump every identifier on the closing fill ─────────────────────────────
    console.log("\n── the stop FIRED. Every identifier on the closing fill ──");
    await sleep(3000);
    const trades = await ex.fetchMyTrades(SYMBOL, startedAt - 60_000, 50);
    const exits = trades.filter((t) => t.side === exitSide);
    check(`a closing (${exitSide}) fill exists`, exits.length > 0, `n=${exits.length}`);

    for (const t of exits) {
      const raw = (t.info ?? {}) as Record<string, unknown>;
      console.log(`  fill ${String(t.id).slice(0, 12)} amount=${t.amount} price=${t.price}`);
      console.log(`      trade.order      = ${t.order ?? "(none)"}`);
      console.log(`      info.orderId     = ${String(raw.orderId ?? "(none)")}`);
      console.log(`      info.orderLinkId = ${JSON.stringify(raw.orderLinkId ?? null)}`);
      console.log(`      info.createType  = ${String(raw.createType ?? "(none)")}`);
      console.log(`      info.stopOrderType = ${String(raw.stopOrderType ?? "(none)")}`);
      console.log(`      info.execType    = ${String(raw.execType ?? "(none)")}`);
      console.log(`      info.closedSize  = ${String(raw.closedSize ?? "(none)")}`);
    }

    // ── the verdict manage.ts needs ───────────────────────────────────────────
    const closing = exits[exits.length - 1];
    const rawClosing = (closing?.info ?? {}) as Record<string, unknown>;
    const sameId = Boolean(stopId && closing?.order === stopId);
    answer("SHAPE", sameId
      ? "SAME-ID — the fill carries the stop's own order id. manage.ts needs NO extra resolution; the recorded STOP row matches directly."
      : "NO PARENT LINK — the fill carries a DIFFERENT order id. manage.ts must key on a raw field instead.");

    if (!sameId) {
      // Is there any child-style link, as on Bitget?
      let childOid: string | null = null;
      if (closing?.order) {
        const child = await ex.fetchOrder(closing.order, SYMBOL, adapter.fetchOrderParams).catch(() => null);
        childOid = child?.clientOrderId ?? (child?.info as { orderLinkId?: string } | undefined)?.orderLinkId ?? null;
        note("the closing order's own clientOrderId/orderLinkId", childOid ?? "(empty)");
      }
      answer("CHILD-OID LINK (Bitget's mechanism)", childOid && childOid === stopId
        ? "PRESENT — same trick as Bitget, resolve via the child's client id"
        : "ABSENT — Bitget's child-clientOid trick does NOT port");
      answer("USABLE DISCRIMINATOR", `createType=${String(rawClosing.createType ?? "?")} stopOrderType=${String(rawClosing.stopOrderType ?? "?")} — teach manage.ts to treat an exit-side fill with this createType as a stop-out`);
    }

    const posAfter = await livePosition(ex, SYMBOL);
    note("position after", `${posAfter?.contracts ?? 0} contracts`);
    note("stop still on the position", (posAfter?.info as { stopLoss?: string })?.stopLoss || "(empty — died with the position)");
    const restingAfter = await strategy.findWorking(ex, SYMBOL);
    check("no orphaned stop left behind after the stop-out", restingAfter.length === 0, `n=${restingAfter.length}`);
  } finally {
    console.log("\n── cleanup ──");
    await flatten(ex);
    const final = await livePosition(ex, SYMBOL);
    check("flat", Number(final?.contracts ?? 0) === 0, `contracts=${final?.contracts ?? 0}`);
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((error) => { console.error("\nERROR:", error instanceof Error ? error.message : error); process.exit(1); });
