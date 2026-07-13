import "server-only";
import { createHash } from "node:crypto";
import type { Exchange, MarketInterface } from "ccxt";
import type { ProfileConfig } from "@/lib/bot-config";
import { beRungIndex } from "@/lib/bot-config";
import { prisma } from "@/lib/db";
import { exchangeClient, type TradeCreds } from "./client";
import { closingSide, rungSizes, sizeFromMargin, slPrice, tpPrice, tradeMargin, type Side, type SizingInput } from "./pricing";
import { MARGIN_MODE, ensurePrepared } from "./prepare";

/**
 * Placing and managing one position on Bitget.
 *
 * Everything below was settled against Bitget's paper engine rather than assumed:
 *
 *  - `createOrders` accepts a batch of reduce-only limit orders — the whole
 *    take-profit ladder goes out in ONE call.
 *  - A duplicate `clientOid` is REJECTED (`code 40786`). Order ids are derived
 *    deterministically from (signal, deployment, kind, rung), so a retried
 *    fan-out cannot double-place. That is what lets us send orders BEFORE writing
 *    to the database.
 *  - `createOrder` returns only an `id`: `average`, `filled` and `status` all come
 *    back undefined. The real fill must be read with `fetchOrder`, and every
 *    take-profit level anchors to it.
 *  - A stop attached to the entry (`stopLoss.triggerPrice`) is a *preset*: a
 *    position-level TPSL, visible only under `planType: "profit_loss"`. It CANNOT
 *    be cancelled through ccxt's unified API — `cancelOrder(id, {stop:true})` and
 *    `cancelAllOrders({trigger:true})` both return OK and do nothing, while
 *    `{planType:"profit_loss"}` returns 43001. It disappears only when the
 *    position closes.
 *  - `params.triggerPrice` creates a `normal_plan` order instead: it has an id,
 *    lists under `{trigger:true}`, and `cancelOrder(id, {trigger:true})` really
 *    removes it. `params.stopLossPrice` does NOT — it makes another uncancellable
 *    position TPSL. Only `triggerPrice` gives a movable stop.
 *  - A plan order and a preset coexist happily.
 *
 * So the stop is two things. The preset placed with the entry is a permanent
 * catastrophic backstop — never naked, not even for one round-trip. The movable
 * working stop is a `triggerPrice` plan order added when break-even arms. Because
 * break-even sits at the entry, between the market and the preset, the working
 * stop is always the tighter of the two and always triggers first; the preset only
 * matters if the working stop is somehow gone.
 */

export type OrderKindName = "ENTRY" | "STOP" | "TP" | "CLOSE";

/**
 * Deterministic `clientOid`. Bitget rejects a repeat, so this is the idempotency
 * that survives a crash between placing an order and recording it.
 */
export function clientOrderId(signalId: string, userBotId: string, kind: OrderKindName, rungIndex?: number): string {
  const seed = `${signalId}:${userBotId}:${kind}:${rungIndex ?? ""}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

export type LadderRung = { rungIndex: number; size: number; price: number };

/**
 * Split the position across the ladder and price each rung off the real entry.
 *
 * Every rung is an independent order, so each must clear the venue's minimum
 * amount *and* minimum notional on its own — a 6-rung ladder whose smallest
 * weight is 0.08 needs a position ~12.5x the minimum order size. Checked before
 * the entry is sent: discovering it afterwards would leave a leveraged position
 * open with no take-profits at all.
 */
export function planLadder(entryPrice: number, size: number, profile: ProfileConfig, side: Side, market: MarketInterface, round: (n: number) => number, roundPrice: (n: number) => number): LadderRung[] {
  const minAmount = Number(market.limits?.amount?.min ?? 0);
  const minCost = Number(market.limits?.cost?.min ?? 0);

  const tooSmall = () => {
    const needed = Math.max(
      ...profile.w.map((weight) => Math.max(minAmount / weight, minCost > 0 ? minCost / (weight * entryPrice) : 0)),
    );
    return new Error(`LADDER_TOO_SMALL:${needed.toPrecision(4)}:${(needed * entryPrice).toFixed(2)}`);
  };

  // Check the UNROUNDED rungs first. `amountToPrecision` throws for anything below
  // one precision step, so rounding before this would raise a ccxt error instead of
  // our actionable one — and would do it after the position was already open.
  for (let k = 0; k < profile.w.length; k++) {
    const raw = size * profile.w[k];
    const price = tpPrice(entryPrice, profile.tp[k], side);
    if (raw < minAmount || (minCost > 0 && raw * price < minCost)) throw tooSmall();
  }

  const sizes = rungSizes(size, profile.w, round);
  const rungs: LadderRung[] = sizes.map((rungSize, rungIndex) => ({
    rungIndex,
    size: rungSize,
    price: roundPrice(tpPrice(entryPrice, profile.tp[rungIndex], side)),
  }));

  // And again after rounding: the final rung absorbs the remainder and could land
  // under the minimum even when its unrounded share cleared it.
  for (const rung of rungs) {
    if (rung.size < minAmount || (minCost > 0 && rung.size * rung.price < minCost)) throw tooSmall();
  }
  return rungs;
}

export type OpenPositionInput = {
  signalId: string;
  userBotId: string;
  userId: string;
  exchange: string;
  creds: TradeCreds;
  symbol: string;
  market: MarketInterface;
  requestedSymbol: string;
  substituted: boolean;
  side: Side;
  profile: ProfileConfig;
  sizing: SizingInput;
  /** Bar-close price from the signal. Sizes the order; never prices the ladder. */
  priceHint: number;
  /** `UserBot.exchangePrepared`, so a prepared account costs no round-trips. */
  prepared: string | null;
};

export type OpenPositionResult = {
  positionId: string;
  symbol: string;
  side: Side;
  size: number;
  entryPrice: number;
  stopPrice: number;
  rungs: LadderRung[];
  rungsPlaced: number;
  substituted: boolean;
};

/**
 * Open one position: market entry with an attached stop, then the whole ladder as
 * resting reduce-only limits.
 *
 * Only the entry is latency-critical — it is a market fill. By the time the ladder
 * goes out the position already exists and is already protected by the attached
 * stop, so reading the true fill first costs nothing that matters.
 */
export async function openPosition(input: OpenPositionInput): Promise<OpenPositionResult> {
  const { creds, exchange, symbol, market, side, profile } = input;

  await ensurePrepared({
    userBotId: input.userBotId,
    exchange,
    creds,
    symbol,
    market,
    leverage: profile.lev,
    prepared: input.prepared,
  });

  const ex = await exchangeClient(exchange, creds, [market]);
  const round = (n: number) => Number(ex.amountToPrecision(symbol, n));
  const roundPrice = (n: number) => Number(ex.priceToPrecision(symbol, n));

  const margin = tradeMargin(input.sizing);
  const minAmount = Number(market.limits?.amount?.min ?? 0);
  const minCost = Number(market.limits?.cost?.min ?? 0);

  // Validate before rounding — `amountToPrecision` throws below one precision step.
  const rawSize = sizeFromMargin(margin, profile.lev, input.priceHint);
  if (!(rawSize > 0) || rawSize < minAmount || rawSize * input.priceHint < minCost) {
    throw new Error(`SIZE_TOO_SMALL:${rawSize.toPrecision(4)}:${minAmount}:${minCost}`);
  }
  const size = round(rawSize);

  // Reject an unplaceable ladder BEFORE opening the position: discovering it after
  // the entry would leave a leveraged position with no take-profits at all.
  planLadder(input.priceHint, size, profile, side, market, round, roundPrice);

  const entrySide = side === "LONG" ? "buy" : "sell";
  const stopAtHint = roundPrice(slPrice(input.priceHint, profile.sl, side));

  // 1 — market entry, stop attached so the position is never naked.
  const entry = await ex.createOrder(symbol, "market", entrySide, size, undefined, {
    marginMode: MARGIN_MODE,
    oneWayMode: true,
    clientOid: clientOrderId(input.signalId, input.userBotId, "ENTRY"),
    stopLoss: { triggerPrice: stopAtHint },
  });

  // Without an id we cannot read the fill, cancel, or reconcile — and a position
  // may already be open. Fail loudly so the reconcile job adopts the orphan.
  if (!entry.id) throw new Error("ENTRY_NO_ORDER_ID");

  // 2 — the true fill. Bitget's createOrder response carries only the id.
  const filled = await ex.fetchOrder(entry.id, symbol);
  const entryPrice = Number(filled.average ?? filled.price ?? input.priceHint);
  const filledSize = Number(filled.filled ?? size);

  // 3 — the whole ladder in one call, priced off the real fill.
  const rungs = planLadder(entryPrice, filledSize, profile, side, market, round, roundPrice);
  const exitSide = closingSide(side);
  let placed: Awaited<ReturnType<Exchange["createOrders"]>> = [];
  let ladderError: string | null = null;
  try {
    placed = await ex.createOrders(
      rungs.map((rung) => ({
        symbol,
        type: "limit" as const,
        side: exitSide,
        amount: rung.size,
        price: rung.price,
        params: {
          reduceOnly: true,
          marginMode: MARGIN_MODE,
          oneWayMode: true,
          clientOid: clientOrderId(input.signalId, input.userBotId, "TP", rung.rungIndex),
        },
      })),
    );
  } catch (error) {
    // The position exists and its stop is live; record the rungs as rejected and
    // let the reconcile job retry rather than throw away a real position.
    ladderError = error instanceof Error ? error.message : String(error);
  }

  // 4 — the preset's id. It is not in the entry response and only lists under
  // `planType: profit_loss`. Off the critical path, but needed later: if the
  // backstop ever fires, its fills must be attributable to this position.
  let presetStopId: string | null = null;
  try {
    const presets = await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" });
    presetStopId = presets[0]?.id ?? null;
  } catch {
    /* the reconcile job will find it */
  }

  const position = await persistPosition({ input, entryPrice, filledSize, stopAtHint, entryOrderId: entry.id, presetStopId, rungs, placed, ladderError });

  return {
    positionId: position.id,
    symbol,
    side,
    size: filledSize,
    entryPrice,
    stopPrice: stopAtHint,
    rungs,
    rungsPlaced: placed.length,
    substituted: input.substituted,
  };
}

async function persistPosition(args: {
  input: OpenPositionInput;
  entryPrice: number;
  filledSize: number;
  stopAtHint: number;
  entryOrderId: string;
  presetStopId: string | null;
  rungs: LadderRung[];
  placed: { id?: string }[];
  ladderError: string | null;
}) {
  const { input, rungs, placed } = args;
  const exitSide = closingSide(input.side);

  return prisma.position.create({
    data: {
      userBotId: input.userBotId,
      userId: input.userId,
      entrySignalId: input.signalId,
      exchange: input.exchange,
      symbol: input.symbol,
      sandbox: input.creds.sandbox,
      side: input.side,
      leverage: input.profile.lev,
      entryPrice: args.entryPrice,
      size: args.filledSize,
      marginUsed: (args.filledSize * args.entryPrice) / input.profile.lev,
      // The attached stop was priced off the signal hint, a few basis points from
      // the fill. `stopPrice` records where it belongs once the fill is known.
      initialStopPrice: args.stopAtHint,
      currentStopPrice: args.stopAtHint,
      orders: {
        create: [
          {
            kind: "ENTRY",
            state: "FILLED",
            exchangeOrderId: args.entryOrderId,
            clientOrderId: clientOrderId(input.signalId, input.userBotId, "ENTRY"),
            side: input.side === "LONG" ? "buy" : "sell",
            size: args.filledSize,
            filledSize: args.filledSize,
            avgFillPrice: args.entryPrice,
          },
          {
            // The uncancellable preset backstop. Its id comes from a follow-up
            // read, not the create response.
            kind: "STOP",
            state: "OPEN",
            exchangeOrderId: args.presetStopId,
            clientOrderId: clientOrderId(input.signalId, input.userBotId, "STOP"),
            side: exitSide,
            price: args.stopAtHint,
            size: args.filledSize,
            reduceOnly: true,
          },
          ...rungs.map((rung, i) => ({
            kind: "TP" as const,
            state: (args.ladderError ? "REJECTED" : "OPEN") as "REJECTED" | "OPEN",
            exchangeOrderId: placed[i]?.id ?? null,
            clientOrderId: clientOrderId(input.signalId, input.userBotId, "TP", rung.rungIndex),
            rungIndex: rung.rungIndex,
            side: exitSide,
            price: rung.price,
            size: rung.size,
            reduceOnly: true,
          })),
        ],
      },
    },
    select: { id: true },
  });
}

/**
 * Move the stop to the entry price once the break-even rung has filled.
 *
 * Places a standalone reduce-only trigger stop at the entry and cancels any
 * earlier one. The entry's attached preset is deliberately left alone: it cannot
 * be cancelled (see the module header), it sits further from price than
 * break-even does, and so it can only ever act as a backstop.
 *
 * Idempotent — a position already at break-even reports false and does nothing,
 * and the deterministic `clientOid` means a racing second call is rejected by the
 * venue rather than placing a second stop.
 */
export async function moveStopToBreakEven(positionId: string): Promise<boolean> {
  const position = await prisma.position.findUnique({
    where: { id: positionId },
    include: { orders: { where: { kind: "STOP" } } },
  });
  if (!position || position.status !== "OPEN" || position.beMoved) return false;

  const connection = await import("@/lib/exchanges/connection").then((m) => m.getDecryptedConnection(position.userId, position.exchange));
  if (!connection) throw new Error("NO_CONNECTION");

  const creds: TradeCreds = { apiKey: connection.apiKey, apiSecret: connection.apiSecret, passphrase: connection.passphrase, sandbox: connection.sandbox };
  const { getMarket } = await import("./client");
  const market = await getMarket(position.exchange, position.symbol, creds.sandbox);
  if (!market) throw new Error(`NO_MARKET:${position.symbol}`);

  const ex = await exchangeClient(position.exchange, creds, [market]);
  const side = position.side as Side;
  const exitSide = closingSide(side);

  const live = (await ex.fetchPositions([position.symbol]))[0];
  const remaining = Number(live?.contracts ?? 0);
  if (remaining <= 0) return false;

  const bePrice = Number(ex.priceToPrecision(position.symbol, position.entryPrice));

  // A stop must sit on the far side of the market: "sell at the entry" is only a
  // stop once price is above the entry. If the break-even rung filled, it is —
  // but a stale or replayed call could arrive early, and Bitget would quietly file
  // a wrong-side trigger as something else entirely. Report not-yet and let the
  // reconcile job try again.
  const mark = Number(live?.markPrice ?? live?.lastPrice ?? 0) || Number((await ex.fetchTicker(position.symbol)).last);
  const beyondEntry = side === "LONG" ? mark > bePrice : mark < bePrice;
  if (!beyondEntry) return false;

  // Only standalone trigger stops, never the preset — it is uncancellable and is
  // the backstop. Read before placing, so we can't cancel the new stop.
  const stale = await standaloneStops(ex, position.symbol);
  const replacement = await ex.createOrder(position.symbol, "market", exitSide, remaining, undefined, {
    marginMode: MARGIN_MODE,
    oneWayMode: true,
    reduceOnly: true,
    triggerPrice: bePrice,
    clientOid: clientOrderId(position.entrySignalId, position.userBotId, "STOP", -1),
  });

  for (const staleId of stale) {
    if (staleId === replacement.id) continue;
    try {
      await ex.cancelOrder(staleId, position.symbol, { trigger: true });
    } catch {
      /* already gone — it triggered, or the venue reaped it */
    }
  }

  await prisma.$transaction([
    prisma.position.update({
      where: { id: position.id },
      data: { beMoved: true, currentStopPrice: bePrice },
    }),
    prisma.order.updateMany({
      where: { positionId: position.id, kind: "STOP" },
      data: { exchangeOrderId: replacement.id ?? null, price: bePrice, state: "OPEN" },
    }),
  ]);
  return true;
}

/**
 * Standalone trigger stops only — the movable ones. Attached presets are excluded
 * on purpose: they are uncancellable, and pretending otherwise means swallowing a
 * cancel that silently did nothing.
 */
async function standaloneStops(ex: Exchange, symbol: string): Promise<string[]> {
  try {
    const orders = await ex.fetchOpenOrders(symbol, undefined, undefined, { trigger: true });
    return orders.map((order) => order.id).filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

/**
 * Flatten a position: cancel everything resting, then market-close what remains.
 * This is what an `exit` signal does — the indicator's stop-loss, ATR trail and
 * reversal exits all arrive as the same instruction, indistinguishable by design.
 *
 * Returns the closing order's id so its fills can be attributed when PnL is booked.
 * The uncancellable preset dies with the position.
 */
export async function closeAll(ex: Exchange, symbol: string, clientOid?: string): Promise<{ flattened: boolean; contracts: number; closeOrderId: string | null }> {
  for (const params of [{}, { trigger: true }]) {
    try {
      await ex.cancelAllOrders(symbol, params);
    } catch {
      /* 22001 "No order to cancel" — nothing of this kind was resting */
    }
  }

  const positions = await ex.fetchPositions([symbol]);
  const open = positions[0];
  const contracts = Number(open?.contracts ?? 0);
  let closeOrderId: string | null = null;
  if (contracts > 0 && open) {
    const order = await ex.createOrder(symbol, "market", open.side === "long" ? "sell" : "buy", contracts, undefined, {
      marginMode: MARGIN_MODE,
      oneWayMode: true,
      reduceOnly: true,
      ...(clientOid ? { clientOid } : {}),
    });
    closeOrderId = order.id ?? null;
  }
  return { flattened: contracts > 0, contracts, closeOrderId };
}

/** Map internal and ccxt failures to something a member can act on. */
export function executionError(error: unknown): { message: string; status: number } {
  const raw = error instanceof Error ? error.message : String(error);

  if (raw === "NO_TICKER") return { message: "This bot has no ticker to trade.", status: 400 };
  if (raw === "NO_CONNECTION") return { message: "Connect your exchange API key first.", status: 400 };
  if (raw.startsWith("NO_MARKET:")) {
    return { message: `No Bitget futures market for this bot (${raw.slice("NO_MARKET:".length)}).`, status: 400 };
  }
  if (raw.startsWith("SIZE_TOO_SMALL:")) {
    const [, size, minAmount, minCost] = raw.split(":");
    return {
      message: `Order size ${size} is below Bitget's minimum (min ${minAmount}, min ~${minCost} USDT notional). Raise capital per trade or leverage.`,
      status: 400,
    };
  }
  if (raw.startsWith("LADDER_TOO_SMALL:")) {
    const [, size, notional] = raw.split(":");
    return {
      message: `Capital per trade is too small to place all take-profit rungs — each rung is a separate order and must clear Bitget's minimum. This bot needs a position of at least ${size} contracts (~${notional} USDT notional).`,
      status: 400,
    };
  }
  if (raw === "ENTRY_NO_ORDER_ID") {
    return { message: "The exchange accepted the entry but returned no order id. Check your position before retrying.", status: 502 };
  }
  if (/duplicate clientoid|40786/i.test(raw)) {
    return { message: "This signal was already executed.", status: 409 };
  }
  // Raised when leverage or margin mode is changed under an open position — e.g.
  // an admin edits the bot's risk class while a member is in a trade.
  if (/45117|currently holding positions/i.test(raw)) {
    return { message: "Leverage or margin mode can't change while a position is open. Close it, then retry.", status: 409 };
  }
  if (/auth|signature|passphrase|apikey|api key|sign/i.test(raw)) {
    return { message: "Exchange key rejected (authentication). Re-connect the key.", status: 400 };
  }
  if (/permission|forbidden/i.test(raw)) {
    return { message: "This key lacks futures trade permission (grant Futures Orders + Holdings).", status: 400 };
  }
  if (/insufficient|margin|balance/i.test(raw)) {
    return { message: "Insufficient balance in the futures wallet for this order.", status: 400 };
  }
  if (/timeout|network|unavailable|ddos/i.test(raw)) {
    return { message: "Couldn't reach the exchange right now. Try again.", status: 502 };
  }
  return { message: `Trade failed: ${raw}`, status: 400 };
}

export { beRungIndex };
