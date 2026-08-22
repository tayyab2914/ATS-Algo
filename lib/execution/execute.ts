import "server-only";
import { createHash } from "node:crypto";
import type { Exchange, MarketInterface } from "ccxt";
import type { ProfileConfig, ProfileSnapshot } from "@/lib/bot-config";
import { beRungIndex } from "@/lib/bot-config";
import { prisma } from "@/lib/db";
import { adapterFor, exchangeClient, livePosition, venueOf, type TradeCreds } from "./client";
import { logExec } from "./log";
import { closingSide, notionalOf, rungSizes, sizeFromMargin, slPrice, tpPrice, tradeMargin, type Side, type SizingInput } from "./pricing";
import { MARGIN_MODE, ensurePrepared } from "./prepare";
import { stopStrategyFor } from "./stops";

/**
 * Placing and managing one position, on any wired venue.
 *
 * This file owns what is COMMON: sizing, the ladder, the ratchet's arithmetic and its
 * monotonicity. Everything that differs per exchange lives behind two seams —
 * `adapterFor()` in ./client for connection and order-shape facts, and `stopStrategyFor()` in
 * ./stops for stop mechanics. Read ./stops before changing anything about stops: the two
 * venues are not differently-spelled, they are structurally different, and the safety argument
 * below is Bitget's alone.
 *
 * ── BITGET ────────────────────────────────────────────────────────────────────
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
 *
 * ── BYBIT — the same guarantee, held up by something else ──────────────────────
 * Do NOT carry the paragraph above across. It is true on Bitget *because* the preset and the
 * working stop occupy two independent slots. Bybit has ONE: the entry-attached stop and the
 * movable stop are the same `position.stopLoss` field under the same order id, so moving the
 * stop OVERWRITES the backstop and clearing it leaves the position genuinely naked (both
 * proven on the demo venue — see ./stops).
 *
 * So on Bybit the guarantee is a property of THIS CODE, not of the venue, and it rests on
 * three rules the strategy enforces:
 *
 *   1. The ratchet OVERWRITES in place and never cancels, so there is no gap to be naked in.
 *   2. Every stop write is READ BACK off the position, because a rejected write returns
 *      success and silently changes nothing.
 *   3. `clearWorking` runs at flatten and nowhere else, and `closeAll` market-closes BEFORE
 *      sweeping, because a bare `cancelAllOrders` takes the backstop with it.
 *
 * Bybit does make one thing genuinely better: its stop is SIZELESS, so it tracks the position
 * down as rungs fill instead of needing the venue to clamp an oversized order.
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
  // `size` and every rung are in VENUE units. On a contract-denominated venue those are not base
  // units, so notional needs converting back before it can be compared to a minimum COST.
  const contractSize = Number(market.contractSize ?? 1) || 1;

  const tooSmall = () => {
    const needed = Math.max(
      ...profile.w.map((weight) =>
        Math.max(minAmount / weight, minCost > 0 ? minCost / (weight * contractSize * entryPrice) : 0),
      ),
    );
    return new Error(`LADDER_TOO_SMALL:${needed.toPrecision(4)}:${notionalOf(needed, entryPrice, contractSize).toFixed(2)}`);
  };

  // Check the UNROUNDED rungs first. `amountToPrecision` throws for anything below
  // one precision step, so rounding before this would raise a ccxt error instead of
  // our actionable one — and would do it after the position was already open.
  for (let k = 0; k < profile.w.length; k++) {
    const raw = size * profile.w[k];
    const price = tpPrice(entryPrice, profile.tp[k], side);
    if (raw < minAmount || (minCost > 0 && notionalOf(raw, price, contractSize) < minCost)) throw tooSmall();
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
    if (rung.size < minAmount || (minCost > 0 && notionalOf(rung.size, rung.price, contractSize) < minCost)) throw tooSmall();
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
  // The base amount one contract represents. 1 on Bitget and Bybit, so everything below is
  // unchanged there; genuinely per-instrument on BloFin (BTC 0.001, ETH 0.01, SOL 1).
  const contractSize = Number(market.contractSize ?? 1) || 1;

  // Validate before rounding — `amountToPrecision` throws below one precision step.
  const rawSize = sizeFromMargin(margin, profile.lev, input.priceHint, contractSize);
  if (!(rawSize > 0) || rawSize < minAmount || notionalOf(rawSize, input.priceHint, contractSize) < minCost) {
    throw new Error(`SIZE_TOO_SMALL:${rawSize.toPrecision(4)}:${minAmount}:${minCost}`);
  }
  const size = round(rawSize);

  // Reject an unplaceable ladder BEFORE opening the position: discovering it after
  // the entry would leave a leveraged position with no take-profits at all.
  planLadder(input.priceHint, size, profile, side, market, round, roundPrice);

  const entrySide = side === "LONG" ? "buy" : "sell";
  const stopAtHint = roundPrice(slPrice(input.priceHint, profile.sl, side));
  const adapter = adapterFor(exchange);
  const strategy = stopStrategyFor(exchange);

  // 1 — market entry, stop attached so the position is never naked. What the attached stop
  // BECOMES differs by venue (Bitget: a sized, uncancellable loss_plan that clamps; Bybit: a
  // sizeless whole-position attribute) — see lib/execution/stops.ts. Both are valid
  // full-position backstops; only Bitget's survives the ratchet independently.
  const entry = await ex.createOrder(symbol, "market", entrySide, size, undefined, {
    ...adapter.orderParams(MARGIN_MODE),
    clientOrderId: clientOrderId(input.signalId, input.userBotId, "ENTRY"),
    ...strategy.entryStopParams(stopAtHint),
  });

  // Without an id we cannot read the fill, cancel, or reconcile — and a position
  // may already be open. Fail loudly so the reconcile job adopts the orphan.
  if (!entry.id) throw new Error("ENTRY_NO_ORDER_ID");

  // 2 — the true fill. `createOrder` returns only an id on EVERY venue we support, so this read
  // always happens, on the latency-critical entry path. How it is done differs: Bitget and Bybit
  // use `fetchOrder` (Bybit refusing it without `acknowledged: true`), while BloFin has no
  // `fetchOrder` at all and reads the closed-order list instead. Hence the seam.
  //
  // A failed read is NOT fatal: fall back to the size we asked for and the signal's price hint.
  // The position exists and its stop is live, so a slightly-off entry price is a worse ladder
  // anchor, not a risk — and reconcile re-reads everything from the venue anyway.
  const filled = await adapter.readFill(ex, symbol, entry.id);
  const entryPrice = Number(filled?.average ?? filled?.price ?? input.priceHint);
  const filledSize = Number(filled?.filled ?? size);

  // 3 — the ladder, priced off the real fill. Chunked to the venue's batch ceiling — Bitget
  // takes 50 legs in one call, Bybit 10 and BingX only 5 — and over-sending is not silently
  // truncated: ccxt throws above the cap.
  const rungs = planLadder(entryPrice, filledSize, profile, side, market, round, roundPrice);
  const exitSide = closingSide(side);
  const rungOids = rungs.map((rung) => clientOrderId(input.signalId, input.userBotId, "TP", rung.rungIndex));
  // Venue order id per rung, by INDEX — not a flat list. A batch can fail halfway on some
  // venues, so "the nth response" and "the nth rung" stop lining up exactly when it matters.
  const placedIds: (string | null)[] = rungs.map(() => null);
  let ladderError: string | null = null;
  try {
    const requests = rungs.map((rung, i) => ({
      symbol,
      type: "limit" as const,
      side: exitSide,
      amount: rung.size,
      price: rung.price,
      params: {
        reduceOnly: true,
        ...adapter.orderParams(MARGIN_MODE),
        clientOrderId: rungOids[i],
      },
    }));
    for (let from = 0; from < requests.length; from += adapter.batchMax) {
      const batch = await ex.createOrders(requests.slice(from, from + adapter.batchMax));
      batch.forEach((order, k) => {
        if (order?.id && order.status !== "rejected") placedIds[from + k] = order.id;
      });
    }
    // A PER-LEG failure does not throw on every venue. Bybit returns top-level retCode 0 and
    // reports bad legs inside the batch, which ccxt surfaces as an order with status
    // "rejected" and NO id — so a try/catch alone would record a rejected rung as placed and
    // the position would trade with a take-profit that does not exist. Inspect every leg.
    const missing = placedIds.filter((id) => !id).length;
    if (missing > 0) ladderError = `LADDER_LEGS_REJECTED:${missing}/${requests.length}`;
  } catch (error) {
    // The position exists and its stop is live; record what actually landed and let the
    // reconcile job retry the rest, rather than throwing away a real position.
    ladderError = error instanceof Error ? error.message : String(error);
  }

  // RECOVERY RE-READ — because a failed batch is not necessarily an empty one.
  //
  // Three different shapes across four venues, and BingX's is the dangerous one: it THROWS and
  // still places the legs that were fine (proven — a 3-leg batch with one bad leg threw 101481
  // and left 2 orders resting). Trusting the throw would persist every rung as REJECTED while
  // real reduce-only orders sit on the book: orphans the database denies exist, which the
  // reconcile job would then try to re-place under the same deterministic client ids — ids the
  // venue has already burned, so the retry can never succeed either.
  //
  // Matching resting orders back by clientOrderId is what makes that recoverable, and it is
  // exactly what the deterministic ids are for. Costs one read, only on the failure path, and is
  // a harmless no-op where the batch really was atomic.
  if (ladderError) {
    const live = await ex.fetchOpenOrders(symbol).catch(() => []);
    const byOid = new Map<string, string>();
    for (const order of live) {
      const rawOrder = (order.info ?? {}) as { clientOrderID?: string; clientOid?: string; clientOrderId?: string };
      const cid = order.clientOrderId ?? rawOrder.clientOrderID ?? rawOrder.clientOrderId ?? rawOrder.clientOid;
      if (cid && order.id) byOid.set(String(cid), order.id);
    }
    rungOids.forEach((oid, i) => {
      if (!placedIds[i]) placedIds[i] = byOid.get(oid) ?? null;
    });
    const stillMissing = placedIds.filter((id) => !id).length;
    // Every leg turned out to be live after all — the throw described the batch, not the book.
    ladderError = stillMissing === 0 ? null : `LADDER_LEGS_REJECTED:${stillMissing}/${rungs.length}`;
    if (ladderError) {
      // A partially-placed ladder is not fatal — the position is open and its backstop is live —
      // but it must not be SILENT. The per-rung REJECTED rows record which legs are missing; this
      // records that it happened at all, with the venue's own words, so a recurring cause
      // (a min-notional floor, a burned client id) is diagnosable rather than inferred from
      // scattered rows. logExec swallows its own write failures, so it cannot break the entry.
      await logExec({
        level: "warn",
        event: "ladder.partiallyPlaced",
        userBotId: input.userBotId,
        signalId: input.signalId,
        detail: {
          exchange, symbol, placed: rungs.length - stillMissing, of: rungs.length,
          missingRungs: placedIds.map((id, i) => (id ? null : i)).filter((i) => i !== null),
        },
      });
    }
  }

  // 4 — the backstop's id. Never in the entry response on either venue, and found differently
  // on each (Bitget filters the profit_loss family for a loss_plan; Bybit filters resting stop
  // orders for stopOrderType StopLoss). Off the critical path, but needed later: if the
  // backstop ever fires, its fills must be attributable to this position.
  const presetStopId = (await strategy.findBackstop(ex, symbol).catch(() => null))?.id ?? null;

  const position = await persistPosition({ input, entryPrice, filledSize, stopAtHint, entryOrderId: entry.id, presetStopId, rungs, placedIds, rungOids });

  return {
    positionId: position.id,
    symbol,
    side,
    size: filledSize,
    entryPrice,
    stopPrice: stopAtHint,
    rungs,
    // What is actually resting on the venue, not how many responses came back — those differ
    // whenever a batch fails partway.
    rungsPlaced: placedIds.filter((id) => id).length,
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
  /** Venue order id per rung, by index. Null where the rung is not resting on the venue. */
  placedIds: (string | null)[];
  rungOids: string[];
}) {
  const { input, rungs, placedIds, rungOids } = args;
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
      // Notional / leverage. `filledSize` is in VENUE units, so a contract-denominated venue
      // needs the contract size folded back in or the recorded margin is out by that factor.
      marginUsed: notionalOf(args.filledSize, args.entryPrice, Number(input.market.contractSize ?? 1) || 1) / input.profile.lev,
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
            // PER RUNG, not per batch. A partial failure leaves some legs genuinely resting, and
            // marking those REJECTED because a sibling failed would hide live reduce-only orders
            // from every later read — the ladder-fill accounting, the flatten sweep and the
            // orphan scan all work off these rows.
            state: (placedIds[i] ? "OPEN" : "REJECTED") as "REJECTED" | "OPEN",
            exchangeOrderId: placedIds[i],
            clientOrderId: rungOids[i],
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
  const live = await livePosition(ex, position.symbol);
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

  // HOW the stop moves is a venue fact, delegated to ./stops, because the two venues need
  // OPPOSITE approaches and picking the wrong one is unsafe rather than merely wrong:
  //
  //   Bitget (2 slots) — CANCEL-FIRST, so exactly one movable pos_loss ever rests, sidestepping
  //     every coexistence case. The brief gap is covered by the uncancellable preset, so the
  //     position is never naked; only the profit-lock is deferred at most one sync.
  //   Bybit (1 slot) — OVERWRITE IN PLACE. Cancel-first here would remove the ONLY stop, and a
  //     failed re-place would leave the position genuinely unprotected. A new trigger replaces
  //     atomically, and the write is READ BACK off the position because a rejected write
  //     returns success and silently changes nothing.
  //
  // The reduce-only `normal_plan` shape is used on NEITHER venue: the reduce-only TP ladder
  // reserves ~100% of the position, so such a stop is STARVED — proven on Bitget's paper venue,
  // where one filled 0.0001 of 0.0018 and died (scripts/verify-preset-demo.ts, section B).
  //
  // A discriminator per generation. Bitget rejects a repeat (40786), which both dedupes a
  // retried sync and lets the strategy ADOPT an already-placed generation instead of throwing.
  // Bybit drops the client id on its stop path entirely, so there idempotency comes from
  // `stopStep` below plus the read-back — never from the venue.
  const oid = clientOrderId(position.entrySignalId, position.userBotId, "STOP", -1 - input.step);
  const strategy = stopStrategyFor(position.exchange);

  const outcome = await strategy.moveWorking(ex, {
    symbol: position.symbol,
    exitSide,
    size,
    stopPrice,
    clientOid: oid,
    marginMode: MARGIN_MODE,
  });

  if (!outcome.moved) {
    // Every reason leaves the PREVIOUS stop exactly where it was, so none can endanger the
    // position. `wrongSideRace` means the mark crossed the trigger between our guard and the
    // venue's check, which coincides with a favourable move. `notConfirmed` means the venue
    // accepted the write and did nothing — only Bybit does that, and the read-back exists to
    // catch it. A warn, because a silent no-op that went unnoticed would be a stale stop.
    // `positionGone` means the position closed underneath us (a rung completing it, or the
    // backstop firing) between the fresh read above and the write — BingX rejects a stop with
    // no position to attach to. Nothing is left to protect, so it is reported as `flat`, the
    // same outcome the pre-read would have produced a moment earlier.
    await logExec({
      level: outcome.reason === "notConfirmed" ? "warn" : "info",
      event: "stop.workingStopMissing",
      positionId: position.id,
      userBotId: position.userBotId,
      detail: { step: input.step, reason: outcome.reason, exchange: position.exchange },
    });
    return { moved: false, reason: outcome.reason === "positionGone" ? "flat" : "wrongSide" };
  }

  // A venue whose stop is a position ATTRIBUTE rather than an order can legitimately return no
  // id (Bybit's mint does). Recorded as-is rather than failing the ratchet: the stop IS live —
  // the read-back proved it — and the cost is that a stop-out attributes via the widened path
  // instead of by id, which is a less specific label, never a wrong number. On a 2-slot venue
  // an id is always returned, so a missing one there is a genuine fault.
  const stopOrderId = outcome.orderId ?? "";
  if (!stopOrderId && strategy.slots === 2) throw new Error("STOP_NO_ORDER_ID");
  const canceled = outcome.canceled;

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

// `movablePosLossStops` and `posLossIdByClientOid` lived here. Both were Bitget plan-family
// lookups and both now live in ./stops as `findWorking`, alongside Bybit's equivalent — because
// the venues disagree on what a "movable stop" even is (Bitget: a separate pos_loss order in the
// profit_loss family; Bybit: the same position attribute the entry's backstop occupies).

/**
 * Flatten a position: cancel everything resting, then market-close what remains.
 * This is what an `exit` signal does — the indicator's stop-loss, ATR trail and
 * reversal exits all arrive as the same instruction, indistinguishable by design.
 *
 * Returns the closing order's id so its fills can be attributed when PnL is booked.
 * The uncancellable preset dies with the position.
 */
export async function closeAll(ex: Exchange, symbol: string, clientOid?: string): Promise<{ flattened: boolean; contracts: number; closeOrderId: string | null }> {
  // Derived from the client, never passed in — see `venueOf`. Every existing caller keeps its
  // `(ex, symbol)` shape, which is the point.
  const exchange = venueOf(ex);
  const adapter = adapterFor(exchange);
  const strategy = stopStrategyFor(exchange);

  const sweepResting = async () => {
    for (const params of [{}, { trigger: true }]) {
      try {
        await ex.cancelAllOrders(symbol, params);
      } catch {
        /* 22001 "No order to cancel" — nothing of this kind was resting */
      }
    }
    // The movable stop survives both sweeps above on a venue where it lives in its own plan
    // family. Remove it by id: being position-level, a stray one can otherwise bind to a
    // freshly-reversed same-symbol position and stop it out at a dead trigger.
    await strategy.clearWorking(ex, symbol).catch(() => {});
  };

  const marketClose = async (): Promise<{ contracts: number; closeOrderId: string | null }> => {
    const open = await livePosition(ex, symbol);
    const contracts = Number(open?.contracts ?? 0);
    if (!(contracts > 0) || !open) return { contracts: 0, closeOrderId: null };
    const order = await ex.createOrder(symbol, "market", open.side === "long" ? "sell" : "buy", contracts, undefined, {
      ...adapter.orderParams(MARGIN_MODE),
      reduceOnly: true,
      ...(clientOid ? { clientOrderId: clientOid } : {}),
    });
    return { contracts, closeOrderId: order.id ?? null };
  };

  // ORDER MATTERS, and it is opposite per venue.
  //
  // On a venue where a bare `cancelAllOrders` also removes the entry's backstop (Bybit —
  // proven: the stop went from 56571.8 to empty with 0.005 still open), sweeping first strips
  // protection from a position that is still open. If the market close then failed — a network
  // blip, a rejection — the position would sit naked with no stop AND no ladder. So there:
  // CLOSE FIRST, then sweep whatever the close left behind.
  //
  // On a venue whose backstop is uncancellable (Bitget), sweeping first is correct and is the
  // long-standing behaviour: it clears the reduce-only ladder so the market close is not
  // fighting its own resting orders for the position.
  let result: { contracts: number; closeOrderId: string | null };
  if (strategy.bareSweepRemovesBackstop) {
    result = await marketClose();
    await sweepResting();
  } else {
    await sweepResting();
    result = await marketClose();
  }
  return { flattened: result.contracts > 0, contracts: result.contracts, closeOrderId: result.closeOrderId };
}

/** Map internal and ccxt failures to something a member can act on. */
export function executionError(error: unknown): { message: string; status: number } {
  const raw = error instanceof Error ? error.message : String(error);

  if (raw === "NO_TICKER") return { message: "This bot has no ticker to trade.", status: 400 };
  if (raw === "NO_CONNECTION") return { message: "Connect your exchange API key first.", status: 400 };
  if (raw.startsWith("UNSUPPORTED_EXCHANGE:")) {
    return { message: `${raw.slice("UNSUPPORTED_EXCHANGE:".length)} isn't wired for trading yet.`, status: 400 };
  }
  // Venue-neutral wording throughout: the same message is shown to a member on any exchange, so
  // it must not name one. The venue's own minimums are already in the numbers.
  if (raw.startsWith("NO_MARKET:")) {
    return { message: `This bot's instrument (${raw.slice("NO_MARKET:".length)}) has no futures market on your exchange.`, status: 400 };
  }
  if (raw.startsWith("SIZE_TOO_SMALL:")) {
    const [, size, minAmount, minCost] = raw.split(":");
    return {
      message: `Order size ${size} is below your exchange's minimum (min ${minAmount}${Number(minCost) > 0 ? `, min ~${minCost} USDT notional` : ""}). Raise capital per trade or leverage.`,
      status: 400,
    };
  }
  if (raw.startsWith("LADDER_TOO_SMALL:")) {
    const [, size, notional] = raw.split(":");
    return {
      message: `Capital per trade is too small to place all take-profit rungs — each rung is a separate order and must clear your exchange's minimum on its own. This bot needs a position of at least ${size} contracts (~${notional} USDT notional).`,
      status: 400,
    };
  }
  if (raw.startsWith("LADDER_LEGS_REJECTED:")) {
    return {
      message: `The exchange rejected some take-profit rungs (${raw.slice("LADDER_LEGS_REJECTED:".length)}). The position is open and its stop is live; the reconcile job will retry the ladder.`,
      status: 502,
    };
  }
  // The member's account is not on isolated margin, and on this venue the setting is
  // account-wide — so we decline rather than changing it for them. Names the exact setting,
  // because "margin mode" alone sends people hunting.
  if (raw.startsWith("MARGIN_MODE_NOT_ISOLATED:")) {
    const found = raw.slice("MARGIN_MODE_NOT_ISOLATED:".length);
    return {
      message: `Your exchange account is set to ${found} margin. This bot only runs on ISOLATED margin, and that setting applies to your whole account — so we won't change it for you. Switch it in your exchange's Margin Mode settings, then activate the bot again.`,
      status: 409,
    };
  }
  if (raw === "MARGIN_MODE_UNKNOWN") {
    return {
      message: "We couldn't confirm your account is on isolated margin, so the bot hasn't started. Check that your API key has read permission for account info, then try again.",
      status: 409,
    };
  }
  // The same refusal on the position-mode axis. Named separately because the fix is a DIFFERENT
  // setting in a different part of the exchange's UI, and telling someone to check "margin mode"
  // when the problem is hedge mode sends them to the wrong screen entirely.
  if (raw === "POSITION_MODE_NOT_ONE_WAY") {
    return {
      message: "Your exchange account is in Hedge position mode. These bots reverse a position when the signal flips, which needs One-way mode — and that setting applies to your whole account, so we won't change it for you. Switch it in your exchange's Position Mode settings with no positions open, then activate the bot again.",
      status: 409,
    };
  }
  if (raw === "POSITION_MODE_UNKNOWN") {
    return {
      message: "We couldn't confirm your account is in One-way position mode, so the bot hasn't started. Check that your API key has read permission, then try again.",
      status: 409,
    };
  }
  if (raw === "ENTRY_NO_ORDER_ID") {
    return { message: "The exchange accepted the entry but returned no order id. Check your position before retrying.", status: 502 };
  }
  // Duplicate client order id. Bitget 40786; Bybit 110072 "OrderLinkedID is duplicate" (plus
  // 110030 / 12141 / 170141 on other product lines).
  // BingX 101481 "clientOrderID cannot be repeated" — and note it stays burned after the order is
  // CANCELLED, not just while it rests, which is what makes it a real idempotency guarantee here.
  if (/duplicate clientoid|orderlinkedid is duplicate|clientorderid cannot be repeated|40786|110072|110030|170141|101481/i.test(raw)) {
    return { message: "This signal was already executed.", status: 409 };
  }
  // Leverage or margin mode changed under an open position — e.g. an admin edits the bot's risk
  // class while a member is in a trade. Bitget 45117; Bybit 110024 (position mode), 110028 (open
  // orders exist), 110036 (cross mode forbids a leverage change).
  if (/45117|currently holding positions|110024|110028|110036|existing position/i.test(raw)) {
    return { message: "Leverage or margin mode can't change while a position is open. Close it, then retry.", status: 409 };
  }
  // Bybit rejects a stop whose trigger is already the wrong side of the mark; BingX answers
  // 110412 ("Stop Loss price should be greater/less than the current price") to the same thing.
  if (/110092|110093|110412|expect (rising|falling)|stop loss price should be/i.test(raw)) {
    return { message: "The stop price is already past the market. Nothing was changed; the previous stop still applies.", status: 409 };
  }
  // Bybit signs with a timestamp; a drifted server clock fails every private call and looks
  // exactly like a bad key. Worth naming, because the fix is NTP, not the API key.
  if (/10002|recv_window|timestamp/i.test(raw)) {
    return { message: "The exchange rejected our request timestamp (server clock drift). This is on our side — please retry shortly.", status: 502 };
  }
  if (/auth|signature|passphrase|apikey|api key|sign/i.test(raw)) {
    return { message: "Exchange key rejected (authentication). Re-connect the key.", status: 400 };
  }
  if (/permission|forbidden/i.test(raw)) {
    return { message: "This key lacks futures trade permission (grant Futures Orders + Holdings).", status: 400 };
  }
  // BingX enforces a 2 USDT minimum notional PER ORDER and rejects with 110425. That is a sizing
  // problem, not a funding one, so it must be matched before the balance catch-all below —
  // otherwise a member is told to add funds when the fix is a bigger position or fewer rungs.
  if (/110425|minimum nominal value/i.test(raw)) {
    return {
      message: "One or more orders were below your exchange's minimum order value (2 USDT each). Raise capital per trade, or use a bot with fewer take-profit rungs.",
      status: 400,
    };
  }
  // BingX 109420 — a stop or reduce-only order was sent with no position to attach to, because
  // the position closed underneath it. Benign by the time anyone reads this.
  if (/109420|position not exist/i.test(raw)) {
    return { message: "The position was already closed, so there was nothing left to adjust.", status: 409 };
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
