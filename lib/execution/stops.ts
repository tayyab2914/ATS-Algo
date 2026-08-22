import "server-only";
import type { Exchange } from "ccxt";
import { livePosition } from "./client";

/**
 * Per-venue stop mechanics — the one part of the engine that does NOT generalise.
 *
 * Everything else about a trade is arithmetic we own: sizing, the ladder's weights, where the
 * stop belongs. This file is the opposite: it is a record of what two exchanges actually do,
 * established by placing real orders on their paper engines, and the two answers are
 * structurally different rather than differently-spelled.
 *
 * THE DIFFERENCE THAT MATTERS — how many stop slots a position has.
 *
 *   Bitget: TWO, independent.
 *     The entry attaches a SIZED `loss_plan` preset that cannot be cancelled and CLAMPS to
 *     whatever the position has shrunk to (verify-preset-demo, section A). The ratchet moves a
 *     SEPARATE position-level `pos_loss` in its own slot. Because the preset survives every
 *     ratchet mistake, "nothing the ratchet gets wrong can leave a position unprotected" is a
 *     property of the VENUE. Proven: a working `pos_loss` at 63433.6 and a `loss_plan`
 *     backstop at 61199.6 resting simultaneously under two different order ids.
 *
 *   Bybit: ONE.
 *     The entry-attached stop and the movable stop are the same `position.info.stopLoss`
 *     field, surfaced under the SAME order id — proven: id 688fa751 carried the entry's
 *     trigger, then both ratchet triggers after it. Moving the stop OVERWRITES the backstop;
 *     clearing it leaves the position genuinely naked. So the same guarantee is a property of
 *     OUR CODE, and it holds only because {@link StopStrategy.moveWorking} overwrites in place
 *     and nothing clears mid-trade.
 *
 * Consequences encoded below, each proven rather than assumed:
 *
 *   - Bitget CANCELS the old generation then places the next; the preset backstops the gap.
 *     Bybit must NEVER cancel — a new `stopLossPrice` replaces atomically with no gap, and a
 *     cancel-first would open a window with no stop at all.
 *   - Bybit's write can SILENTLY NO-OP: the venue returns retCode 0 with an empty result and
 *     does nothing (that is how a sized/Partial stop fails there). So every Bybit stop write
 *     is READ BACK off the position. Never trust the create response.
 *   - A bare `cancelAllOrders(symbol)` REMOVES Bybit's backstop (proven: stop 56571.8 → empty
 *     with 0.005 still open) and does NOT remove Bitget's. {@link bareSweepRemovesBackstop}
 *     is what stops a flatten from stripping protection before the close lands.
 *   - Bybit's movable stop returns NO id and NO client id from the mint, but IS discoverable
 *     afterwards via `fetchOpenOrders` with a real id and `info.stopOrderType === "StopLoss"`.
 *
 * All venue access goes through ccxt. The one raw call —
 * `privatePostV5PositionTradingStop` — is a ccxt implicit method generated from its own api
 * tree, used because the unified layer cannot express clearing a stop (`stopLossPrice: 0`
 * throws on price precision before it reaches the wire).
 */

/** Which slot a resting stop occupies, as far as the venue is concerned. */
export type StopSlot = "BACKSTOP" | "WORKING";

export type RestingStop = {
  id: string;
  clientOid?: string;
  triggerPrice: number | null;
  slot: StopSlot;
};

export type MoveWorkingArgs = {
  symbol: string;
  /** The side that CLOSES the position — "sell" for a long. */
  exitSide: "buy" | "sell";
  /** Remaining contracts, freshly read. Some venues ignore it (a sizeless stop). */
  size: number;
  stopPrice: number;
  /** Deterministic client id. Ignored by venues that drop it on the stop path. */
  clientOid: string;
  marginMode: string;
};

export type MoveWorkingResult =
  | {
      moved: true;
      /** Null on a venue whose stop is a position attribute rather than an order (Bybit). */
      orderId: string | null;
      /** True when a prior crashed attempt had already placed this exact generation. */
      adopted: boolean;
      /** Older generations actually cancelled. Always empty on a venue that overwrites. */
      canceled: string[];
    }
  | { moved: false; reason: "wrongSideRace" | "notConfirmed" | "positionGone" };

export type StopStrategy = {
  venue: string;
  /**
   * Independent stop slots per position. 2 ⇒ the backstop survives every ratchet mistake and
   * the never-naked guarantee is the venue's. 1 ⇒ it is ours to preserve, and the ratchet must
   * overwrite rather than cancel.
   */
  slots: 1 | 2;
  /**
   * True when `cancelAllOrders(symbol)` with no params would also take the backstop out. When
   * true, a flatten MUST market-close before it sweeps, or it strips protection from a
   * position it has not yet closed.
   */
  bareSweepRemovesBackstop: boolean;
  /** Params merged into the ENTRY `createOrder` so the position is never naked. */
  entryStopParams(triggerPrice: number): Record<string, unknown>;
  /** The entry-attached backstop, whose id the entry response never carries. */
  findBackstop(ex: Exchange, symbol: string): Promise<RestingStop | null>;
  /** Every movable stop currently resting. On a one-slot venue this is at most one. */
  findWorking(ex: Exchange, symbol: string): Promise<RestingStop[]>;
  /** Move the working stop to a new price. Owns the cancel-vs-overwrite decision. */
  moveWorking(ex: Exchange, args: MoveWorkingArgs): Promise<MoveWorkingResult>;
  /** Remove every movable stop. Called at flatten and settle, never mid-trade. */
  clearWorking(ex: Exchange, symbol: string): Promise<void>;
};

// ── shared helpers ───────────────────────────────────────────────────────────

const numberOrNull = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
};

/** ccxt exposes a venue's raw payload on `info`; these are the fields we read by name. */
type RawOrder = { planType?: string; stopOrderType?: string; triggerPrice?: string; clientOid?: string };

const rawOf = (order: { info?: unknown }): RawOrder => (order.info ?? {}) as RawOrder;

// ── Bitget ───────────────────────────────────────────────────────────────────

/**
 * Two slots, in one `profit_loss` family. Filtering is STRICTLY on `planType`, never on size:
 * the preset carries the entry size while a `pos_loss` reports 0, so size is not a
 * discriminator — and letting a `loss_plan` into the working set would let a cancel sweep the
 * one stop that guarantees the position is never naked.
 */
const bitget: StopStrategy = {
  venue: "Bitget",
  slots: 2,
  // The preset is uncancellable and dies only with the position — a bare sweep cannot take it.
  bareSweepRemovesBackstop: false,

  entryStopParams: (triggerPrice) => ({ stopLoss: { triggerPrice } }),

  async findBackstop(ex, symbol) {
    const family = await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" }).catch(() => []);
    // Find the loss_plan EXPLICITLY, never `[0]`: once a ratchet pos_loss coexists, the family
    // holds two orders in venue order and `[0]` is a trap.
    const found = family.find((order) => rawOf(order).planType === "loss_plan") ?? family[0];
    if (!found?.id) return null;
    return { id: found.id, clientOid: found.clientOrderId ?? rawOf(found).clientOid, triggerPrice: numberOrNull(rawOf(found).triggerPrice), slot: "BACKSTOP" };
  },

  async findWorking(ex, symbol) {
    const family = await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" }).catch(() => []);
    return family
      .filter((order) => Boolean(order.id) && rawOf(order).planType === "pos_loss")
      .map((order) => ({
        id: order.id as string,
        clientOid: order.clientOrderId ?? rawOf(order).clientOid,
        triggerPrice: numberOrNull(rawOf(order).triggerPrice),
        slot: "WORKING" as const,
      }));
  },

  async moveWorking(ex, args) {
    // CANCEL-FIRST, deliberately. Exactly ONE movable pos_loss must ever rest, which sidesteps
    // every coexistence case (add / replace-in-place / reject). The brief gap is backstopped by
    // the uncancellable preset, so at worst the profit-lock is deferred one sync — the position
    // is never unprotected. A pos_loss cancels ONLY with the planType, never bare {trigger:true}.
    const resting = await this.findWorking(ex, args.symbol);
    const mine = resting.find((stop) => stop.clientOid === args.clientOid) ?? null;
    const canceled: string[] = [];
    for (const stale of resting) {
      if (mine && stale.id === mine.id) continue; // never cancel our own generation
      try {
        await ex.cancelOrder(stale.id, args.symbol, { planType: "pos_loss", trigger: true });
        canceled.push(stale.id);
      } catch {
        /* already gone — it triggered, or the venue reaped it */
      }
    }
    // A crashed prior attempt already placed this exact generation. Its price is deterministic
    // for a step, so adopt it rather than burn the clientOid re-placing it (40786).
    if (mine) return { moved: true, orderId: mine.id, adopted: true, canceled };

    try {
      // `stopLossPrice` mints a pos_loss. NOT `triggerPrice` + `reduceOnly`, which the
      // reduce-only TP ladder STARVES — proven: such a stop filled 0.0001 of 0.0018 and died,
      // leaving the position open (verify-preset-demo, section B).
      const placed = await ex.createOrder(args.symbol, "market", args.exitSide, args.size, undefined, {
        marginMode: args.marginMode,
        oneWayMode: true,
        stopLossPrice: args.stopPrice,
        clientOid: args.clientOid,
      });
      const id = placed.id ?? (await this.findWorking(ex, args.symbol)).find((s) => s.clientOid === args.clientOid)?.id ?? null;
      return { moved: true, orderId: id, adopted: false, canceled };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // 40917: the mark crossed the trigger between our guard and the venue's check.
      if (/40917|stop price|mark price/i.test(raw)) return { moved: false, reason: "wrongSideRace" };
      // 40786: raced our own just-placed generation, not yet visible to the enumeration above.
      if (/40786|duplicate/i.test(raw)) {
        const adopted = (await this.findWorking(ex, args.symbol)).find((s) => s.clientOid === args.clientOid)?.id ?? null;
        if (adopted) return { moved: true, orderId: adopted, adopted: true, canceled };
      }
      throw error;
    }
  },

  async clearWorking(ex, symbol) {
    // By id, and ONLY pos_loss. A stray pos_loss is position-level, so left behind it can bind
    // to a freshly-reversed same-symbol position and stop it out at a dead trigger. The
    // loss_plan preset is left alone — uncancellable, and it dies with the position anyway.
    for (const stop of await this.findWorking(ex, symbol)) {
      await ex.cancelOrder(stop.id, symbol, { planType: "pos_loss", trigger: true }).catch(() => {});
    }
  },
};

// ── Bybit ────────────────────────────────────────────────────────────────────

/** ccxt's implicit method for POST /v5/position/trading-stop, generated from its api tree. */
type TradingStopExchange = Exchange & {
  privatePostV5PositionTradingStop(params: Record<string, unknown>): Promise<unknown>;
};

/**
 * ONE slot. `findBackstop` and `findWorking` read the SAME venue row on purpose — there is no
 * second stop to find, and pretending otherwise is how a caller would talk itself into
 * cancelling the only protection the position has.
 */
const bybit: StopStrategy = {
  venue: "Bybit",
  slots: 1,
  // PROVEN: a bare cancelAllOrders took the stop from 56571.8 to empty with 0.005 still open.
  // The Full-mode stop is a real row in the PLAIN order list, not only under {trigger:true}.
  bareSweepRemovesBackstop: true,

  // A bare `stopLoss` field leaves tpslMode at the venue default (Full) ⇒ a SIZELESS
  // whole-position stop that tracks the position down on its own. Proven: after a 0.003 rung
  // filled off 0.010, its order row read amount 0.007 with the trigger unchanged. Never pass a
  // size here — a sized (Partial) stop does not arm at all on this path, and fails SILENTLY.
  entryStopParams: (triggerPrice) => ({ stopLoss: { triggerPrice } }),

  async findBackstop(ex, symbol) {
    const [only] = await bybit.findWorking(ex, symbol);
    return only ? { ...only, slot: "BACKSTOP" } : null;
  },

  async findWorking(ex, symbol) {
    // orderFilter=StopOrder on the same endpoint as normal orders. There is no planType here;
    // the analogue is the raw `stopOrderType`, which ccxt never reads, so we filter on it
    // ourselves.
    const orders = await ex.fetchOpenOrders(symbol, undefined, undefined, { trigger: true }).catch(() => []);
    return orders
      .filter((order) => Boolean(order.id) && rawOf(order).stopOrderType === "StopLoss")
      .map((order) => ({
        id: order.id as string,
        clientOid: order.clientOrderId ?? undefined,
        triggerPrice: numberOrNull(rawOf(order).triggerPrice),
        slot: "WORKING" as const,
      }));
  },

  async moveWorking(ex, args) {
    // OVERWRITE IN PLACE. Never cancel: there is only one slot, so cancelling to re-place would
    // leave the position with NO stop for the duration. Writing a new stopLossPrice replaces
    // the trigger atomically — proven 60896.5 → 61524.3, same slot, same order id, no gap.
    //
    // amount 0 selects tpslMode Full (sizeless). ccxt DROPS clientOrderId on this path, so the
    // stop has no deterministic handle and idempotency cannot come from the venue — it comes
    // from the caller's own step bookkeeping plus the read-back below.
    try {
      await ex.createOrder(args.symbol, "market", args.exitSide, 0, undefined, {
        stopLossPrice: args.stopPrice,
        tradingStopEndpoint: true,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // 110092/110093: the mark crossed the trigger between our guard and the venue's check.
      if (/110092|110093|expect (Rising|Falling)/i.test(raw)) return { moved: false, reason: "wrongSideRace" };
      throw error;
    }

    // READ BACK — non-negotiable on this venue. A rejected stop write returns retCode 0 with an
    // empty result and changes nothing, so the create response cannot tell us whether the
    // position is protected. Only the position can.
    const live = await livePosition(ex, args.symbol);
    const onVenue = numberOrNull((live?.info as { stopLoss?: string } | undefined)?.stopLoss);
    if (onVenue === null) return { moved: false, reason: "notConfirmed" };

    const resting = await bybit.findWorking(ex, args.symbol);
    // `canceled` is always empty here and that is the invariant, not an omission: this venue
    // overwrites, and anything that cancelled would be removing the position's only stop.
    return { moved: true, orderId: resting[0]?.id ?? null, adopted: false, canceled: [] };
  },

  async clearWorking(ex, symbol) {
    // ONLY at flatten. On a one-slot venue this removes the backstop too, so calling it while a
    // position is open is exactly how you get a naked position.
    //
    // ccxt cannot express the clear: `stopLossPrice: 0` throws on priceToPrecision before
    // reaching the wire ("must be greater than minimum price precision of 0.1"). So the raw
    // implicit method is the only route, and it is why this is a first-class primitive.
    const marketId = ex.markets?.[symbol]?.id;
    if (!marketId) return;
    await (ex as TradingStopExchange)
      .privatePostV5PositionTradingStop({ category: "linear", symbol: marketId, stopLoss: "0", tpslMode: "Full", positionIdx: 0 })
      .catch(() => {
        /* nothing set, or the position is already gone */
      });
  },
};

// ── BloFin ───────────────────────────────────────────────────────────────────

/**
 * A FOURTH shape — not Bitget's and not Bybit's. All four facts below were established with real
 * orders on the demo engine (scripts/probe-blofin-stops.ts):
 *
 *   ONE FAMILY, MANY STOPS. Every stop — including the one attached to the entry — lives in the
 *     `tpsl` family, and they STACK: three rested simultaneously at 57851.9 / 62362.8 / 63024.5.
 *     So the ratchet must CANCEL-FIRST (like Bitget), not overwrite (like Bybit).
 *   SIZED, never sizeless. A sizeless mint is rejected outright — `152001 "Parameter size cannot
 *     be empty."` So a stop carries a fixed size and goes stale as filled rungs shrink the
 *     position beneath it, exactly like Bitget's preset.
 *   NOT STARVED. A sized reduce-only TPSL closed the WHOLE position with a full-size reduce-only
 *     ladder resting. This is the one that could have killed the venue: Bitget's equivalent
 *     shape fills a sliver and dies. BloFin's does not.
 *   NO UNCANCELLABLE BACKSTOP. The entry-attached stop is an ordinary TPSL — cancellable, and
 *     indistinguishable by kind from a ratchet generation. Cancelling the family wholesale
 *     removes it and leaves the position naked; the probe did exactly that by accident.
 *
 * That last point is what {@link findBackstop} and {@link findWorking} exist to manage. They
 * split the one family by AGE: the oldest resting TPSL is the entry's backstop and is never
 * touched, everything newer is a ratchet generation and may be cancelled. Age is the only
 * discriminator the venue gives us — there is no planType (Bitget) and no separate slot (Bybit).
 */
const blofin: StopStrategy = {
  venue: "Blofin",
  // Two EFFECTIVE slots, enforced by us rather than the venue: the oldest TPSL is held back from
  // every cancel, so a ratchet mistake still leaves the entry's backstop in place.
  slots: 2,
  // Cancels are always by explicit id here, never a blanket sweep, so this stays false. It is
  // NOT the venue being safe — it is this strategy never issuing the dangerous call.
  bareSweepRemovesBackstop: false,

  // Rides on the entry order as slTriggerPrice + slOrderPrice "-1" (market on trigger) and then
  // surfaces as a TPSL sized to the entry.
  entryStopParams: (triggerPrice) => ({ stopLoss: { triggerPrice } }),

  async findBackstop(ex, symbol) {
    const [oldest] = await tpslByAge(ex, symbol);
    return oldest ? { ...oldest, slot: "BACKSTOP" } : null;
  },

  async findWorking(ex, symbol) {
    // Everything EXCEPT the oldest. When only the entry's stop rests this is empty, which is
    // correct: the ratchet has not placed anything yet.
    return (await tpslByAge(ex, symbol)).slice(1);
  },

  async moveWorking(ex, args) {
    // CANCEL-FIRST over ratchet generations only — never the oldest, which is the backstop. A
    // sized stop is the only shape available, so size it from the caller's FRESH position read;
    // an oversized stop would otherwise linger as rungs fill.
    const canceled: string[] = [];
    for (const stale of await blofin.findWorking(ex, args.symbol)) {
      try {
        await ex.cancelOrder(stale.id, args.symbol, { tpsl: true });
        canceled.push(stale.id);
      } catch {
        /* already gone — it triggered, or the venue reaped it */
      }
    }

    // `tpsl: true` routes to trade/order-tpsl. `marginMode` is MANDATORY: ccxt defaults it to
    // 'cross' (blofin.js createTpslOrderRequest), which would place the stop under the wrong
    // margin model. reduceOnly defaults to true there, which is what we want.
    try {
      await ex.createOrder(args.symbol, "market", args.exitSide, args.size, undefined, {
        tpsl: true,
        stopLossPrice: args.stopPrice,
        marginMode: args.marginMode,
        clientOrderId: args.clientOid,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // WRONG-SIDE RACE. Every venue rejects a stop already past the market; only the code and
      // the reference price differ, and BloFin's reference is the awkward one:
      //
      //   102038 / 102040  the trigger is the wrong side of the LATEST TRADED PRICE
      //   102048 / 102050 / 102055  the wrong side of the best BID or ASK
      //
      // Bitget evaluates 40917 on the MARK, and `ratchetStop`'s pre-flight guard deliberately
      // uses the mark to match it. BloFin instead judges against last-traded and the top of book,
      // which drift apart from the mark — so the guard and the venue disagree MORE OFTEN here,
      // and this catch is load-bearing rather than defensive. Without it the throw escapes
      // `ratchetStop` and the reconcile pass records an error for what is a normal, benign
      // outcome: the price ran away from the stop, so the profit-lock waits one sync.
      //
      // Safe by construction on this venue: the cancel above only ever removed OLDER ratchet
      // generations, never the entry backstop, so the position is still protected.
      if (/\b(102038|102040|102048|102050|102055)\b|trigger price should be|must be (higher|lower) than/i.test(raw)) {
        return { moved: false, reason: "wrongSideRace" };
      }
      throw error;
    }

    // Read back rather than trust the mint. Cheap here, and it also yields the venue id: the
    // create response's id is not reliably the tpslId the cancel path needs.
    const resting = await blofin.findWorking(ex, args.symbol);
    const mine = resting.find((s) => s.clientOid === args.clientOid) ?? resting[resting.length - 1];
    if (!mine) return { moved: false, reason: "notConfirmed" };
    return { moved: true, orderId: mine.id, adopted: false, canceled };
  },

  async clearWorking(ex, symbol) {
    // Ratchet generations only. The backstop is deliberately left alive — it dies with the
    // position, and on this venue nothing else protects it.
    for (const stop of await blofin.findWorking(ex, symbol)) {
      await ex.cancelOrder(stop.id, symbol, { tpsl: true }).catch(() => {});
    }
  },
};

/**
 * Every resting TPSL, OLDEST FIRST.
 *
 * Age is load-bearing, not cosmetic: it is the only thing distinguishing the entry's backstop
 * from a ratchet generation on this venue. `timestamp` can be absent, so ties fall back to the
 * id — which BloFin allocates monotonically — rather than leaving the order undefined.
 */
async function tpslByAge(ex: Exchange, symbol: string): Promise<RestingStop[]> {
  const orders = await ex.fetchOpenOrders(symbol, undefined, undefined, { tpsl: true }).catch(() => []);
  return orders
    .filter((order) => Boolean(order.id))
    .map((order) => ({
      id: order.id as string,
      clientOid: order.clientOrderId ?? (rawOf(order) as { clientOrderId?: string }).clientOrderId,
      triggerPrice: numberOrNull((rawOf(order) as { slTriggerPrice?: string }).slTriggerPrice),
      slot: "WORKING" as const,
      _at: Number(order.timestamp ?? 0),
    }))
    .sort((a, b) => a._at - b._at || String(a.id).localeCompare(String(b.id)))
    .map(({ _at, ...stop }) => {
      void _at;
      return stop;
    });
}

// ── BingX ────────────────────────────────────────────────────────────────────

/**
 * Structurally BloFin's shape, arrived at independently — every claim below was established with
 * real orders on the VST demo engine (scripts/probe-bingx-stops.ts, scripts/probe-bingx-reversal.ts):
 *
 *   ONE ORDER FAMILY, AND `trigger` IS NOT A FILTER. `fetchOpenOrders(symbol)` and the same call
 *     with `{trigger: true}` hit the SAME endpoint and return the SAME rows — the flag just rides
 *     along in the query string. So there is no family to filter on: stops are told apart from
 *     ladder legs by their raw `type` (`STOP_MARKET`), and from each other only by AGE.
 *   STOPS STACK. Two rested simultaneously at 64662.5 and 69699.8 under separate ids, so the
 *     ratchet must CANCEL-FIRST (Bitget/BloFin), never overwrite (Bybit).
 *   SIZED, never sizeless. A sizeless mint is rejected before it leaves ccxt (amount below the
 *     precision floor), so a stop carries a fixed size and goes stale as rungs fill beneath it.
 *   NOT STARVED — the question that could have sunk the venue, and it was answered twice. A sized
 *     reduce-only STOP_MARKET closed the WHOLE position with a full-size reduce-only ladder
 *     resting. Bitget's equivalent shape fills a sliver and dies; BingX's does not.
 *   THE BARE SWEEP IS SAFE HERE, and unusually so: `cancelAllOrders(symbol)` cleared the resting
 *     reduce-only LIMIT legs but left BOTH stops untouched. So it removes the ladder without ever
 *     stripping protection — the one venue where sweep-then-close is not merely tolerable but
 *     strictly better.
 *   STOPS ARE REAPED WITH THE POSITION. Closing a position removed both its stops with no cancel
 *     from us, and a stop cannot even be MINTED while flat (`109420 position not exist`). So the
 *     stray-stop-binds-to-a-reversal hazard that `clearWorking` exists for on Bitget cannot occur
 *     here — which is why this venue needs no naked-position discipline of its own.
 *
 * As on BloFin, the entry's backstop is an ordinary cancellable stop, indistinguishable by kind
 * from a ratchet generation. AGE is the only discriminator: the oldest resting stop is the
 * backstop and is never cancelled; everything newer is a generation and may be.
 */
const bingx: StopStrategy = {
  venue: "Bingx",
  // Two EFFECTIVE slots, enforced here rather than by the venue — the oldest stop is held back
  // from every cancel, so a ratchet mistake still leaves the entry's backstop in place.
  slots: 2,
  // PROVEN false, and it is the venue being safe rather than us avoiding the call: a bare
  // `cancelAllOrders` took the ladder and left both stops resting on an open position.
  bareSweepRemovesBackstop: false,

  // ccxt folds this into the entry as a `stopLoss` JSON field whose `quantity` DEFAULTS to the
  // entry amount (bingx.js:3189) — so it arrives as a sized STOP_MARKET with reduceOnly true,
  // resting in the ordinary order list with its own id.
  entryStopParams: (triggerPrice) => ({ stopLoss: { triggerPrice } }),

  async findBackstop(ex, symbol) {
    const [oldest] = await bingxStopsByAge(ex, symbol);
    return oldest ? { ...oldest, slot: "BACKSTOP" } : null;
  },

  async findWorking(ex, symbol) {
    // Everything EXCEPT the oldest. Empty while only the entry's stop rests, which is correct:
    // the ratchet has not placed anything yet.
    return (await bingxStopsByAge(ex, symbol)).slice(1);
  },

  async moveWorking(ex, args) {
    // CANCEL-FIRST over ratchet generations only — never the oldest, which is the backstop.
    const canceled: string[] = [];
    const restingStops = await bingx.findWorking(ex, args.symbol);
    const mine = restingStops.find((stop) => stop.clientOid === args.clientOid) ?? null;
    for (const stale of restingStops) {
      if (mine && stale.id === mine.id) continue; // never cancel our own generation
      try {
        await ex.cancelOrder(stale.id, args.symbol);
        canceled.push(stale.id);
      } catch {
        /* already gone — it triggered, or the venue reaped it with the position */
      }
    }
    // A crashed prior attempt already placed this exact generation — adopt it rather than
    // re-place, exactly as on Bitget.
    if (mine) return { moved: true, orderId: mine.id, adopted: true, canceled };

    try {
      // `reduceOnly` MUST be passed explicitly. ccxt sets a LOCAL reduceOnly=true on the
      // stopLossPrice path (bingx.js:3144) but NEVER writes `request['reduceOnly']` — the flag
      // reaches the wire only as passthrough of these params, and in hedge mode it is dropped
      // entirely in favour of positionSide. Omitting it here would mint a plain STOP_MARKET.
      await ex.createOrder(args.symbol, "market", args.exitSide, args.size, undefined, {
        stopLossPrice: args.stopPrice,
        reduceOnly: true,
        clientOrderId: args.clientOid,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // WRONG-SIDE RACE. ccxt maps neither of these codes, so they arrive as a bare
      // ExchangeError and must be matched by number and text:
      //   110412  "Stop Loss price should be greater than the current price" (and its mirror
      //           for a short) — the mark crossed the trigger between our guard and the venue's.
      if (/\b110412\b|stop loss price should be (greater|less|lower|higher)/i.test(raw)) {
        return { moved: false, reason: "wrongSideRace" };
      }
      // 109420 "position not exist" — the position closed between `ratchetStop`'s fresh read and
      // this write (a rung completing it, or the backstop firing). Benign and expected under a
      // filling ladder, and NOT a failure: there is nothing left to protect. Distinguished from
      // the race above because it is not about price at all.
      if (/\b109420\b|position not exist/i.test(raw)) return { moved: false, reason: "positionGone" };
      throw error;
    }

    // Read back rather than trust the mint: the create response's id is not reliably the one the
    // cancel path needs, and this also confirms the stop is really resting.
    const after = await bingx.findWorking(ex, args.symbol);
    const placed = after.find((s) => s.clientOid === args.clientOid) ?? after[after.length - 1];
    if (!placed) return { moved: false, reason: "notConfirmed" };
    return { moved: true, orderId: placed.id, adopted: false, canceled };
  },

  async clearWorking(ex, symbol) {
    // Ratchet generations only — the oldest is the backstop and dies with the position anyway.
    for (const stop of await bingx.findWorking(ex, symbol)) {
      await ex.cancelOrder(stop.id, symbol).catch(() => {});
    }
  },
};

/**
 * Every resting STOP order, OLDEST FIRST.
 *
 * Age is load-bearing rather than cosmetic: it is the only thing telling the entry's backstop
 * apart from a ratchet generation, because both are `STOP_MARKET` rows in the one order family.
 *
 * The type match is an exact allow-list, NOT a substring test on "STOP": `TRAILING_STOP_MARKET`
 * would also contain it, and sweeping a trailing stop the member set by hand into our working set
 * would let the ratchet cancel someone else's order.
 */
async function bingxStopsByAge(ex: Exchange, symbol: string): Promise<RestingStop[]> {
  const orders = await ex.fetchOpenOrders(symbol).catch(() => []);
  const STOP_TYPES = new Set(["STOP_MARKET", "STOP"]);
  return orders
    .filter((order) => {
      const type = (rawOf(order) as { type?: string }).type;
      return Boolean(order.id) && type !== undefined && STOP_TYPES.has(type);
    })
    .map((order) => ({
      id: order.id as string,
      clientOid: order.clientOrderId ?? (rawOf(order) as { clientOrderID?: string }).clientOrderID,
      triggerPrice: numberOrNull((rawOf(order) as { stopPrice?: string }).stopPrice),
      slot: "WORKING" as const,
      _at: Number(order.timestamp ?? 0),
    }))
    // BingX ids are monotonic numeric strings of equal width, so they are a sound tie-break when
    // two stops share a timestamp — which they can, the venue stamping only to the second.
    .sort((a, b) => a._at - b._at || String(a.id).localeCompare(String(b.id)))
    .map(({ _at, ...stop }) => {
      void _at;
      return stop;
    });
}

const STRATEGIES: Record<string, StopStrategy> = { Bitget: bitget, Bybit: bybit, Blofin: blofin, Bingx: bingx };

/** The stop mechanics for a venue. Throws for a venue the engine cannot trade. */
export function stopStrategyFor(exchange: string): StopStrategy {
  const strategy = STRATEGIES[exchange];
  if (!strategy) throw new Error(`UNSUPPORTED_EXCHANGE:${exchange}`);
  return strategy;
}
