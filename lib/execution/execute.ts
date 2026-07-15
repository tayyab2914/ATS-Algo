import "server-only";
import { createHash } from "node:crypto";
import type { Exchange, MarketInterface } from "ccxt";
import type { ProfileConfig, ProfileSnapshot } from "@/lib/bot-config";
import { beRungIndex } from "@/lib/bot-config";
import { prisma } from "@/lib/db";
import { exchangeClient, type TradeCreds } from "./client";
import { logExec } from "./log";
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
 *  - A stop attached to the entry (`stopLoss.triggerPrice`) is the *preset*: a
 *    position-level TPSL, visible only under `planType: "profit_loss"`, where it lists
 *    as a `loss_plan`. It CANNOT be cancelled through ccxt's unified API and disappears
 *    only when the position closes.
 *  - The preset is SIZED (frozen at the entry size), NOT sizeless — but because a swing
 *    position only ever shrinks, the preset is always oversized-never-undersized, and on
 *    trigger Bitget CLAMPS it to the live position (closes exactly what is there, no
 *    overshoot into a reverse). So it is still a valid full-position backstop, just by
 *    clamping rather than auto-sizing. All proven on the paper venue, not read from source.
 *  - The MOVABLE stop is a `pos_loss` (`params.stopLossPrice`), NOT a reduce-only
 *    `normal_plan` (`params.triggerPrice`). This is load-bearing and was WRONG before:
 *    the reduce-only TP ladder reserves ~100% of the position, so a reduce-only plan stop
 *    is STARVED — on trigger it fills 0 and is rejected, and the position stays open. It
 *    had never fired in production. A `pos_loss` is position-level and ignores those
 *    reservations, closing the whole position. It CAN be cancelled — via
 *    `cancelOrder(id, {planType:"pos_loss", trigger:true})` (the earlier "uncancellable"
 *    verdict used the wrong cancel params) — so the ratchet can move it. It coexists with
 *    the preset in its own slot (loss_plan and pos_loss are separate slots).
 *  - Placing a tighter `pos_loss` REPLACES the single slot in place; we still CANCEL-FIRST
 *    so exactly one movable stop ever rests, regardless of the venue's coexistence rule.
 *  - When a `pos_loss` triggers it is executed by a CHILD market order whose `clientOid`
 *    equals the pos_loss plan-order id — that is how a stop-out is attributed (manage.ts).
 *
 * So the stop is two things, and the asymmetry between them IS the safety model:
 *
 *   - The PRESET, placed with the entry, is the full-position backstop at `sl%`. It cannot
 *     be cancelled, cannot go stale, and dies only with the trade. It clamps to whatever
 *     the position is. The position is never naked — not for one round-trip, and not after
 *     any number of partial fills.
 *   - The WORKING stop is a `pos_loss` that the ratchet moves closer to entry after each
 *     filled rung, and eventually past entry to lock profit. It only ever tightens, so it
 *     is always inside the preset and always triggers first.
 *
 * The consequence worth internalising: **nothing the ratchet gets wrong can leave a
 * position unprotected.** A wrong-side target (loudly rejected, 40917), a burned clientOid
 * (40786), a config that drifted, even a brief gap while cancel-first swaps generations —
 * every one of them merely means the profit-lock does not happen, and the trade falls back
 * to the preset, never looser than the original `sl%`. The ratchet optimises; it cannot
 * endanger.
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
  /**
   * The profile + fee/slippage assumptions FROZEN onto the position. Every stop
   * decision for the life of this trade reads this, never the live bot config — an
   * admin editing the bot mid-trade must not move the stop under an open position.
   */
  snapshot: ProfileSnapshot;
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
    // Find the loss_plan explicitly — NEVER `[0]`. This read is unambiguous now (only the
    // preset exists pre-ratchet), but once a ratchet pos_loss coexists the family holds two
    // orders in venue order, so `[0]` would be a trap for anyone copying this pattern.
    presetStopId = presets.find((o) => (o.info as { planType?: string } | undefined)?.planType === "loss_plan")?.id
      ?? presets[0]?.id ?? null;
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
      // Freeze the rules this trade lives by. Read for every stop decision from here
      // on, so an admin editing the bot can never move the stop under an open trade.
      profileSnapshot: input.snapshot,
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
            // The uncancellable preset backstop — stop GENERATION 0. Its id comes from
            // a follow-up read, not the create response. Every later generation gets its
            // OWN row: this id must survive, or the preset's fills become unattributable
            // when PnL is booked.
            kind: "STOP",
            state: "OPEN",
            exchangeOrderId: args.presetStopId,
            clientOrderId: clientOrderId(input.signalId, input.userBotId, "STOP"),
            rungIndex: 0,
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

/** Why a ratchet did nothing. Each is a normal outcome, not an error. */
export type RatchetSkip =
  | "notOpen"        // settled, or gone
  | "flat"           // the venue holds nothing — reconcile will close the row
  | "alreadyAtStep"  // this generation (or a tighter one) is already live
  | "notTighter"     // the target would LOOSEN the stop; never allowed
  | "wrongSide"      // the target is beyond the mark — a stop there cannot exist
  | "noSize";        // the remainder is below the venue's minimum

export type RatchetResult =
  | { moved: true; step: number; stopPrice: number; orderId: string; canceled: string[] }
  | { moved: false; reason: RatchetSkip };

/**
 * Move the working stop to a new generation — the progressive ratchet.
 *
 * The stop is TWO things, and only one of them moves. The preset attached to the
 * entry is a Bitget *position* TPSL: it carries no size, closes the whole position,
 * cannot be cancelled, and dies with the trade. It is the unconditional backstop and
 * is never touched here. The working stop is a `normal_plan` trigger order — the only
 * movable kind, and the only one with a size — and it is what this function replaces.
 *
 * That asymmetry is the safety story: **nothing this function can get wrong leaves the
 * position unprotected.** Every skip below simply leaves the previous stop (or, at
 * worst, the preset at the original `sl%`) in place. The ratchet optimises; it cannot
 * endanger.
 *
 * Ordering is deliberate: read the stale stops, place the new one, and only then
 * cancel the stale. There is no instant with no stop on the book.
 */
export async function ratchetStop(input: {
  positionId: string;
  /** Generation = rungs filled. Never 0 — that is the entry's preset. */
  step: number;
  /** Signed distance from entry, %. NEGATIVE ⇒ the stop sits on the PROFIT side. */
  distancePct: number;
}): Promise<RatchetResult> {
  const position = await prisma.position.findUnique({
    where: { id: input.positionId },
    include: { orders: { where: { kind: "STOP" } } },
  });
  if (!position || position.status !== "OPEN") return { moved: false, reason: "notOpen" };

  // Idempotency. A generation is never re-placed: its clientOid is already burned at
  // the venue, and Bitget rejects a duplicate with 40786. This also makes the ratchet
  // strictly monotonic — it can only ever go forwards.
  if (input.step <= position.stopStep) return { moved: false, reason: "alreadyAtStep" };

  const connection = await import("@/lib/exchanges/connection").then((m) => m.getDecryptedConnection(position.userId, position.exchange));
  if (!connection) throw new Error("NO_CONNECTION");

  const creds: TradeCreds = { apiKey: connection.apiKey, apiSecret: connection.apiSecret, passphrase: connection.passphrase, sandbox: connection.sandbox };
  const { getMarket } = await import("./client");
  const market = await getMarket(position.exchange, position.symbol, creds.sandbox);
  if (!market) throw new Error(`NO_MARKET:${position.symbol}`);

  const ex = await exchangeClient(position.exchange, creds, [market]);
  const side = position.side as Side;
  const exitSide = closingSide(side);

  // Size from a FRESH read, every time. The working stop is a fixed-size plan order,
  // and each filled rung shrinks the position underneath it — the DB row still carries
  // the original entry size, and an arm-time snapshot goes stale the moment the next
  // rung fills. Read what is actually there.
  const live = (await ex.fetchPositions([position.symbol]))[0];
  const remaining = Number(live?.contracts ?? 0);
  if (remaining <= 0) return { moved: false, reason: "flat" };
  const size = Number(ex.amountToPrecision(position.symbol, remaining));
  if (!(size > 0)) return { moved: false, reason: "noSize" };

  const stopPrice = Number(ex.priceToPrecision(position.symbol, slPrice(position.entryPrice, input.distancePct, side)));
  if (!(stopPrice > 0)) return { moved: false, reason: "wrongSide" };

  // Never loosen. The maths already guarantees this, but an admin can swap a config
  // mid-trade, so the invariant is enforced against what is actually on the book.
  const tighter = side === "LONG" ? stopPrice > position.currentStopPrice : stopPrice < position.currentStopPrice;
  if (!tighter) return { moved: false, reason: "notTighter" };

  // A pos_loss must sit on the FAR side of the MARK. "Sell at X" only stops while the mark
  // is above X. A wrong-side pos_loss is LOUDLY rejected (40917) — unlike the old normal_plan,
  // which was silently re-filed — so we guard here to avoid the round-trip, then catch 40917
  // below for the guard-vs-venue race. Decided against the MARK explicitly (never last/ticker):
  // the venue evaluates 40917 on the mark, so a `last != mark` fallback could disagree with the
  // venue at zero elapsed time. Price retracing after a spike-fill lands here — correct.
  const mark = Number(live?.markPrice ?? 0) || Number((await ex.fetchTicker(position.symbol)).last);
  const farSide = side === "LONG" ? stopPrice < mark : stopPrice > mark;
  if (!farSide) return { moved: false, reason: "wrongSide" };

  // CANCEL-FIRST. The movable stop is a pos_loss (position-level TPSL). A reduce-only plan
  // stop is STARVED — the reduce-only TP ladder reserves ~100% of the position, so on trigger
  // it fills 0 and is rejected; a pos_loss ignores those reservations and closes the whole
  // position. We cancel the prior generation BEFORE placing the next so exactly ONE movable
  // pos_loss ever rests, which sidesteps every coexistence case (add / replace-in-place /
  // reject). The brief gap is backstopped by the uncancellable preset at `sl%` — never naked,
  // only the profit-lock is deferred at most one sync. A pos_loss cancels ONLY with the
  // planType, never bare {trigger:true}, and we filter strictly to pos_loss so the loss_plan
  // PRESET can never enter the stale set and be swept.
  // A discriminator per generation. Bitget rejects a repeat (40786), which both dedupes a
  // retried sync and lets us ADOPT an already-placed generation instead of throwing.
  const oid = clientOrderId(position.entrySignalId, position.userBotId, "STOP", -1 - input.step);

  // Cancel every OLDER generation — but NEVER our own. If a prior attempt placed THIS
  // generation on the venue and then crashed before recording it, cancelling it here and
  // re-placing would burn its clientOid (40786) and then fail to re-find it (we just
  // cancelled it), wedging the step. So adopt our own generation and cancel only the rest.
  // Reuses the one enumeration; no extra round-trip.
  const movable = await movablePosLossStops(ex, position.symbol);
  const alreadyMine = movable.find((o) => o.clientOid === oid)?.id ?? null;
  const canceled: string[] = [];
  for (const staleStop of movable) {
    if (staleStop.id === alreadyMine) continue;
    try {
      await ex.cancelOrder(staleStop.id, position.symbol, { planType: "pos_loss", trigger: true });
      canceled.push(staleStop.id);
    } catch {
      /* already gone — it triggered, or the venue reaped it */
    }
  }

  let stopOrderId: string;
  if (alreadyMine) {
    // A crashed prior attempt already placed this exact generation. The price is
    // deterministic for a step (frozen entry × fixed distance), so it is the right stop.
    stopOrderId = alreadyMine;
  } else {
    try {
      // `stopLossPrice` mints a pos_loss. NOT `triggerPrice`+`reduceOnly` (starves); NOT the
      // entry's `stopLoss.triggerPrice` (that is the uncancellable loss_plan preset).
      const placed = await ex.createOrder(position.symbol, "market", exitSide, size, undefined, {
        marginMode: MARGIN_MODE,
        oneWayMode: true,
        stopLossPrice: stopPrice,
        clientOid: oid,
      });
      // createOrder for a TPSL may not return a usable id — resolve it by our clientOid.
      stopOrderId = placed.id ?? (await posLossIdByClientOid(ex, position.symbol, oid)) ?? "";
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // 40917: the mark ticked across the trigger between our guard and the venue's check. Any
      // older generation is already cancelled, so only the preset remains — but this coincides
      // with a favourable move (price ran away from the stop). Let the next sync retry.
      if (/40917|stop price|mark price/i.test(raw)) {
        await logExec({ level: "info", event: "stop.workingStopMissing", positionId: position.id, userBotId: position.userBotId, detail: { step: input.step, reason: "wrongSideRace" } });
        return { moved: false, reason: "wrongSide" };
      }
      // 40786: raced with our own just-placed generation (it was not yet visible to the
      // enumeration above). Adopt it.
      if (/40786|duplicate/i.test(raw)) {
        stopOrderId = (await posLossIdByClientOid(ex, position.symbol, oid)) ?? "";
      } else {
        throw error;
      }
    }
  }
  if (!stopOrderId) throw new Error("STOP_NO_ORDER_ID");

  // One row per generation, keyed by clientOid. Every generation keeps its own
  // exchangeOrderId (the pos_loss plan-order id) — `realizedPnlFor` and the stop-out
  // attribution both key off these, and losing an id drops PnL into the widening path.
  // Written only AFTER a confirmed place + id capture, so a crash between cancel and place
  // never advances stopStep or leaves a fired generation unrecorded.
  const atOrBeyondEntry = side === "LONG" ? stopPrice >= position.entryPrice : stopPrice <= position.entryPrice;
  await prisma.$transaction([
    prisma.order.upsert({
      where: { clientOrderId: oid },
      create: {
        positionId: position.id, kind: "STOP", state: "OPEN",
        exchangeOrderId: stopOrderId, clientOrderId: oid, rungIndex: input.step,
        side: exitSide, price: stopPrice, size, reduceOnly: false,
      },
      update: { exchangeOrderId: stopOrderId, price: stopPrice, size, state: "OPEN" },
    }),
    // Retire the generations we just cancelled. Generation 0 (the preset) is left OPEN —
    // it is still live on the venue and only dies with the position.
    prisma.order.updateMany({
      where: { positionId: position.id, kind: "STOP", state: "OPEN", rungIndex: { gt: 0, lt: input.step } },
      data: { state: "CANCELED" },
    }),
    prisma.position.update({
      where: { id: position.id },
      data: {
        stopStep: input.step,
        currentStopPrice: stopPrice,
        // Monotone: once the stop has reached entry it never reads as un-armed again.
        beMoved: position.beMoved || atOrBeyondEntry,
      },
    }),
  ]);

  return { moved: true, step: input.step, stopPrice, orderId: stopOrderId, canceled };
}

/**
 * The movable `pos_loss` stops only — the ones the ratchet places and moves. These live in
 * the `profit_loss` family ALONGSIDE the entry preset (a `loss_plan`), so we filter STRICTLY
 * on `planType === "pos_loss"`: the loss_plan preset is the uncancellable full-position
 * backstop and must NEVER enter the stale set, or a cancel would try to sweep the one stop
 * that guarantees the position is never naked. Never discriminate by size (the preset carries
 * the entry size; a pos_loss reports size 0) — only by planType.
 */
async function movablePosLossStops(ex: Exchange, symbol: string): Promise<{ id: string; clientOid: string | undefined }[]> {
  try {
    const orders = await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" });
    return orders
      .filter((order) => Boolean(order.id) && (order.info as { planType?: string } | undefined)?.planType === "pos_loss")
      .map((order) => ({
        id: order.id as string,
        clientOid: order.clientOrderId ?? (order.info as { clientOid?: string } | undefined)?.clientOid,
      }));
  } catch {
    return [];
  }
}

/**
 * Resolve a just-placed pos_loss's order id by the clientOid we sent — createOrder for a
 * TPSL can come back without a usable id, and once a pos_loss coexists with the preset in
 * the `profit_loss` family, `[0]` is a trap. Match on planType AND clientOid.
 */
async function posLossIdByClientOid(ex: Exchange, symbol: string, clientOid: string): Promise<string | null> {
  try {
    const orders = await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" });
    const mine = orders.find(
      (order) =>
        (order.info as { planType?: string } | undefined)?.planType === "pos_loss" &&
        (order.clientOrderId === clientOid || (order.info as { clientOid?: string } | undefined)?.clientOid === clientOid),
    );
    return mine?.id ?? null;
  } catch {
    return null;
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

  // A movable pos_loss lives in the profit_loss family and SURVIVES both sweeps above. Cancel
  // it by id BEFORE the market close: being position-level, a stray pos_loss can otherwise bind
  // to a freshly-reversed same-symbol position and stop it out at a dead trigger. Leave the
  // loss_plan preset (uncancellable, and it dies with the position anyway).
  try {
    for (const order of await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" })) {
      if ((order.info as { planType?: string } | undefined)?.planType === "pos_loss" && order.id) {
        await ex.cancelOrder(order.id, symbol, { planType: "pos_loss", trigger: true }).catch(() => {});
      }
    }
  } catch {
    /* nothing resting */
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
