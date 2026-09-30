import "server-only";
import type { Exchange } from "ccxt";
import {
  beRungIndex,
  profileFor,
  snapshotProfile,
  stopPlan,
  type BotConfig,
  type ProfileConfig,
  type ProfileSnapshot,
} from "@/lib/bot-config";
import { prisma } from "@/lib/db";
import { getDecryptedConnection } from "@/lib/exchanges/connection";
import { adapterFor, exchangeClient, getMarket, livePosition, type TradeCreds } from "./client";
import { clientOrderId, closeAll, ratchetStop } from "./execute";
import { errorDetail, logExec } from "./log";
import type { Side } from "./pricing";
import { stopStrategyFor } from "./stops";

/**
 * Reconciling one open position against the venue.
 *
 * The exchange, not our bookkeeping, is the source of truth. We never infer a fill
 * from price — a resting limit at a rung may be wicked through without filling —
 * so every rung's state is read back, and realized PnL is summed from actual
 * trades, at their actual prices, net of their actual fees.
 *
 * Shared by the `tp`/`exit` signal handlers and the reconcile cron. Idempotent:
 * running it twice changes nothing the second time.
 */

export type SyncResult = {
  positionId: string;
  rungsFilled: number;
  /** The working stop advanced a generation on this pass. */
  stopMoved: boolean;
  closed: boolean;
  realizedPnl: number | null;
};

type LoadedPosition = NonNullable<Awaited<ReturnType<typeof loadPosition>>>;

function loadPosition(positionId: string) {
  return prisma.position.findUnique({
    where: { id: positionId },
    include: {
      orders: true,
      userBot: { select: { id: true, compounding: true, bot: { select: { riskClass: true, config: true } } } },
    },
  });
}

/**
 * The rules this position actually trades by.
 *
 * Prefers the snapshot frozen at open — the live bot config must never decide the stop
 * of an already-open trade, or an admin editing the bot would move the stop underneath
 * it. Falls back to the live config only for rows written before the snapshot column
 * existed, which is precisely the behaviour those rows were opened with.
 */
function positionSnapshot(position: LoadedPosition): ProfileSnapshot | null {
  const frozen = position.profileSnapshot as unknown as ProfileSnapshot | null;
  if (frozen && Array.isArray(frozen.tp)) return frozen;

  const config = position.userBot.bot.config as unknown as BotConfig;
  const profile = profileFor(config, position.userBot.bot.riskClass);
  return profile ? snapshotProfile(config, profile) : null;
}

type Trades = Awaited<ReturnType<Exchange["fetchMyTrades"]>>;
type Fill = Trades[number];

/** The venue publishes a fill a beat after it executes; settle reads it seconds later. */
const FILL_READ_ATTEMPTS = 3;
const FILL_READ_BACKOFF_MS = 1_200;
/** Past this, a still-provisional PnL is no longer publication lag but a fill we cannot own. */
const PNL_STALE_AFTER_MS = 60 * 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What the VENUE itself booked as realized profit on one fill, when it reports one.
 *
 * Every wired venue carries this on a closing fill — Bitget `profit` (UTA `execPnl`), Bybit
 * `execPnl`, BingX `realizedPnl`, BloFin `pnl` — gross of fees, which are charged per fill
 * and summed separately. Null when this venue, or this fill, reports none.
 *
 * Used as the PROVISIONAL figure for a set we cannot yet complete, and as a cross-check
 * against our own arithmetic when we can. Never as the booked number on its own: the field
 * name differs per venue and an unrecognised one must degrade to "no figure", not to a
 * confident wrong one.
 */
function venueRealized(fill: Fill): number | null {
  const info = fill.info as Record<string, unknown> | null | undefined;
  if (!info) return null;
  for (const key of ["profit", "execPnl", "realizedPnl", "pnl"]) {
    const raw = info[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export type Attribution = {
  /** Realized PnL from our own fills, net of fees. Meaningful only when `complete`. */
  pnl: number;
  /** The same trade as the venue booked it, when every fill reported a figure. */
  venuePnl: number | null;
  /** Both legs are present and each reconciles against `position.size`. */
  complete: boolean;
  openedAmount: number;
  closedAmount: number;
  fills: number;
};

/**
 * Realized PnL for ONE position, from the venue's own fills — and only from the fills this
 * position's own orders produced.
 *
 * BOTH LEGS OR NOTHING. `sell` proceeds minus `buy` cost is a PnL only when the set is
 * BALANCED: every contract opened and every contract closed present. A missing fill does not
 * make the number slightly wrong, it makes it wrong by that fill's whole notional. That is
 * not hypothetical — position cmukej7fq01kimoqjlx51aam9 booked +$2,669.12 against a true
 * +$18.22 because the closing fill had not been published when we read, 4.4s after it
 * executed, and because the fallback then widened to every fill on the symbol and swept in
 * the PREVIOUS trade's closing sell. On a reversal that trade closes ~3s before this one
 * opens, so it is ALWAYS inside the window: there is deliberately no widening any more.
 *
 * Completeness is therefore checked on both sides and reported, never assumed. An incomplete
 * set is not booked — the caller defers it, and `resettlePnl` finishes it once the venue has
 * caught up.
 *
 * `contractSize` is the base amount ONE contract represents, and it is NOT optional on a
 * contract-denominated venue: ccxt reports `trade.amount` in the venue's own units, so on
 * BloFin a fill of "18.4" is 18.4 contracts = 0.0184 BTC, not 18.4 BTC — without the factor a
 * $300 trade booked a PnL of 1,196,097. Amounts stay in VENUE units throughout, because the
 * only thing they are compared against is `position.size`, which is stored in venue units
 * too. Converting one and not the other is how this class of bug happens in the first place.
 */
export function attribute(args: {
  trades: Trades;
  ourOrderIds: Set<string>;
  exitSide: "buy" | "sell";
  positionSize: number;
  contractSize: number;
}): Attribution {
  const { trades, ourOrderIds, exitSide, positionSize, contractSize } = args;

  let cashflow = 0;
  let fees = 0;
  let venueSum = 0;
  let everyFillReports = true;
  let openedAmount = 0;
  let closedAmount = 0;
  let fills = 0;

  for (const trade of trades) {
    if (!trade.order || !ourOrderIds.has(trade.order)) continue;
    fills++;
    const amount = Number(trade.amount);
    cashflow += (trade.side === "sell" ? 1 : -1) * Number(trade.price) * amount * contractSize;
    fees += Number(trade.fee?.cost ?? 0);
    if (trade.side === exitSide) closedAmount += amount;
    else openedAmount += amount;

    const realized = venueRealized(trade);
    if (realized === null) everyFillReports = false;
    else venueSum += realized;
  }

  const reconciles = (amount: number) => Math.abs(amount - positionSize) <= positionSize * 0.01;
  return {
    pnl: cashflow - fees,
    venuePnl: fills > 0 && everyFillReports ? venueSum - fees : null,
    complete: fills > 0 && reconciles(openedAmount) && reconciles(closedAmount),
    openedAmount,
    closedAmount,
    fills,
  };
}

/**
 * Read the venue's fills for this position and attribute them, retrying while the set is
 * still short — a fill is published a beat after it executes, and settle runs seconds after
 * sending the close.
 *
 * Also folds in the fills whose order id we never recorded but which are provably ours:
 *
 *  - A STOP-OUT. When a pos_loss/preset TPSL fires, Bitget executes it with a CHILD market
 *    order minted on trigger: the fill carries the CHILD's id, not the plan-order id we
 *    recorded — but the child's clientOid IS that plan-order id (proven on the venue).
 *  - A CLOSE whose id we lost. `closeAll` returns `order.id ?? null`, so a venue that
 *    answers without one leaves the flatten fill unattributable. Its clientOid is ours and
 *    deterministic, so it can still be recognised.
 *
 * Every rescued fill is matched on an id WE issued. Nothing is adopted because it merely
 * happens to sit in the window.
 */
async function readAttribution(args: {
  ex: Exchange;
  exchange: string;
  symbol: string;
  since: number;
  ourOrderIds: Set<string>;
  ourClientOids: Set<string>;
  stopPlanIds: Set<string>;
  exitSide: "buy" | "sell";
  positionSize: number;
  contractSize: number;
  attempts: number;
}): Promise<{ attribution: Attribution | null; stoppedOut: boolean; error: unknown }> {
  const { ex, exchange, symbol, since, ourOrderIds, ourClientOids, stopPlanIds, exitSide } = args;

  let attribution: Attribution | null = null;
  let stoppedOut = false;
  let error: unknown = null;
  const unresolvable = new Set<string>();

  for (let attempt = 0; attempt < args.attempts; attempt++) {
    if (attempt > 0) await sleep(FILL_READ_BACKOFF_MS);
    try {
      const trades = await ex.fetchMyTrades(symbol, since, 100);

      for (const t of trades) {
        if (t.side !== exitSide || !t.order || ourOrderIds.has(t.order) || unresolvable.has(t.order)) continue;
        try {
          // Through the adapter, NOT `ex.fetchOrder` directly: BloFin has no `fetchOrder` at
          // all, so a direct call threw there and this whole path was dead on that venue.
          const child = await adapterFor(exchange).readFill(ex, symbol, t.order);
          const childOid = child?.clientOrderId;
          if (childOid && stopPlanIds.has(childOid)) {
            ourOrderIds.add(t.order);
            stoppedOut = true;
          } else if (childOid && ourClientOids.has(childOid)) {
            ourOrderIds.add(t.order);
          } else {
            unresolvable.add(t.order);
          }
        } catch {
          /* unresolved; it stays foreign, and the set simply stays incomplete */
        }
      }

      // Belt-and-braces: some venues DO carry the plan-order id directly on the fill.
      if (!stoppedOut) stoppedOut = trades.some((t) => t.side === exitSide && t.order && stopPlanIds.has(t.order));

      attribution = attribute({
        trades,
        ourOrderIds,
        exitSide,
        positionSize: args.positionSize,
        contractSize: args.contractSize,
      });
      error = null;
      if (attribution.complete) break;
    } catch (caught) {
      // A failed read is not a zero PnL. Keep whatever the last successful attempt saw; if
      // none succeeded the caller defers, and the reconcile pass retries from scratch.
      error = caught;
    }
  }

  return { attribution, stoppedOut, error };
}

/**
 * Does our own arithmetic agree with the venue's? They must, and on a complete set they do —
 * verified against live Bitget fills. A divergence means one of the two is reading the trade
 * in different units, which is precisely the failure mode that once booked 1,196,097 on a
 * $300 trade, so it is worth a loud line in the log even though the booked number does not
 * change. Tolerance is a cent, or half a percent on a large trade, to absorb the venue
 * rounding its own figure.
 */
function pnlDisagrees(attribution: Attribution): boolean {
  if (attribution.venuePnl === null) return false;
  const tolerance = Math.max(0.01, Math.abs(attribution.pnl) * 0.005);
  return Math.abs(attribution.pnl - attribution.venuePnl) > tolerance;
}

async function clientFor(position: LoadedPosition): Promise<{ ex: Exchange; creds: TradeCreds; contractSize: number } | null> {
  const connection = await getDecryptedConnection(position.userId, position.exchange);
  if (!connection) return null;
  const creds: TradeCreds = {
    apiKey: connection.apiKey,
    apiSecret: connection.apiSecret,
    passphrase: connection.passphrase,
    sandbox: connection.sandbox,
  };
  const market = await getMarket(position.exchange, position.symbol, creds.sandbox);
  if (!market) return null;
  return {
    ex: await exchangeClient(position.exchange, creds, [market]),
    creds,
    // 1 on Bitget and Bybit, so every calculation downstream is unchanged there.
    contractSize: Number(market.contractSize ?? 1) || 1,
  };
}

/**
 * Read a position's true state and act on it: mark filled rungs, arm break-even
 * when the configured rung has *actually filled*, and settle the position once the
 * venue shows it flat.
 *
 * `flatten` closes it first — that is what an `exit` signal does.
 */
export async function syncPosition(positionId: string, opts: { flatten?: boolean; reason?: string } = {}): Promise<SyncResult> {
  const position = await loadPosition(positionId);
  if (!position || position.status !== "OPEN") {
    return { positionId, rungsFilled: 0, stopMoved: false, closed: true, realizedPnl: null };
  }

  // The rules this trade lives by, frozen when it opened. NEVER the live bot config:
  // an admin editing the bot — or its risk class — while a position is open would
  // otherwise move `sl`, the ladder, even `tp[]` underneath the open trade. Positions
  // written before the snapshot column existed fall back to the live config, which is
  // exactly the behaviour they were opened with.
  const snapshot = positionSnapshot(position);
  const client = await clientFor(position);
  if (!client) {
    await logExec({ level: "warn", event: "sync.noConnection", positionId, userBotId: position.userBotId });
    return { positionId, rungsFilled: position.tpRungsFilled, stopMoved: false, closed: false, realizedPnl: null };
  }
  const { ex, contractSize } = client;

  let closeOrderId: string | null = null;
  if (opts.flatten) {
    const result = await closeAll(ex, position.symbol, clientOrderId(position.entrySignalId, position.userBotId, "CLOSE"));
    closeOrderId = result.closeOrderId;
    if (closeOrderId) {
      await prisma.order.create({
        data: {
          positionId: position.id,
          kind: "CLOSE",
          state: "FILLED",
          exchangeOrderId: closeOrderId,
          clientOrderId: clientOrderId(position.entrySignalId, position.userBotId, "CLOSE"),
          side: position.side === "LONG" ? "sell" : "buy",
          size: result.contracts,
          filledSize: result.contracts,
          reduceOnly: true,
        },
      }).catch(() => {
        /* a retried exit re-uses the same clientOrderId; the row already exists */
      });
    }
  }

  // Which of our orders are still resting? Anything of ours that is gone has either filled or
  // been cancelled, and only the venue can say which.
  //
  // The stop passes are REQUIRED, not belt-and-braces: on Bitget a live movable pos_loss (and
  // the preset) appears in neither {} nor {trigger:true}, so without its own pass a live STOP
  // row reads as "not resting" and falls through to `fetchOrder` by bare id below — which
  // cannot address a TPSL and can mis-mark the row while the stop is still protecting the
  // position. The strategy contributes whatever its venue needs, so a venue whose stops live on
  // the ordinary order list (Bybit) does not get a meaningless extra round-trip.
  const strategy = stopStrategyFor(position.exchange);
  const restingIds = new Set<string>();
  for (const params of [{}, { trigger: true }]) {
    try {
      for (const order of await ex.fetchOpenOrders(position.symbol, undefined, undefined, params)) {
        if (order.id) restingIds.add(order.id);
      }
    } catch {
      /* nothing of this kind */
    }
  }
  for (const stop of [...(await strategy.findWorking(ex, position.symbol)), await strategy.findBackstop(ex, position.symbol)]) {
    if (stop?.id) restingIds.add(stop.id);
  }

  for (const order of position.orders) {
    const terminal = order.state === "FILLED" || order.state === "CANCELED" || order.state === "REJECTED";
    if (terminal || !order.exchangeOrderId || restingIds.has(order.exchangeOrderId)) continue;
    try {
      // A STOP row that is still live was already added to `restingIds` above, so anything
      // reaching here has left the book. Note for a venue whose stops need their own filter to
      // be addressable (Bybit): a FIRED stop may not be found by a bare id, which throws and is
      // swallowed below — the row simply stays OPEN until settle marks it, so it self-heals
      // rather than mis-marking a live stop.
      const live = await adapterFor(position.exchange).readFill(ex, position.symbol, order.exchangeOrderId);
      if (!live) continue; // unreadable this pass; settle will mark it, or the next sync retries
      const filled = Number(live.filled ?? 0);
      const state = live.status === "closed" && filled > 0 ? "FILLED" : live.status === "canceled" ? "CANCELED" : order.state;
      await prisma.order.update({
        where: { id: order.id },
        data: { state, filledSize: filled, avgFillPrice: live.average ? Number(live.average) : order.avgFillPrice },
      });
      order.state = state;
      order.filledSize = filled;
    } catch {
      /* transient; the next sync picks it up */
    }
  }

  const rungsFilled = position.orders.filter((o) => o.kind === "TP" && o.state === "FILLED").length;
  if (rungsFilled !== position.tpRungsFilled) {
    await prisma.position.update({ where: { id: position.id }, data: { tpRungsFilled: rungsFilled } });
    await logExec({ level: "info", event: "tp.filled", positionId, userBotId: position.userBotId, detail: { rungsFilled } });
  }

  // ── The stop ──────────────────────────────────────────────────────────────
  // The RATCHET keys off the COUNT of filled rungs. A count is right (and a rung index
  // is wrong) precisely because the ladder isn't ascending: price fills rungs in PRICE
  // order, so after n fills it is the n NEAREST rungs that are gone.
  //
  // The LEGACY `be` rule still keys off its rung's INDEX — that is what `beRungFilled`
  // carries. Which of the two runs is decided by the config alone: a profile without
  // `sl_tighten_pct` behaves exactly as it does today.
  let stopMoved = false;
  if (snapshot) {
    const beIndex = beRungIndex(snapshot as unknown as ProfileConfig);
    const plan = stopPlan({
      snapshot,
      side: position.side as Side,
      rungsFilled,
      beRungFilled:
        beIndex !== null &&
        position.orders.some((o) => o.kind === "TP" && o.rungIndex === beIndex && o.state === "FILLED"),
    });

    if (plan.violatesGeometry) {
      // Unreachable via a validated config — validation rejects an unsound ladder at
      // upload. So this means the config drifted (edited in the DB, or a fee changed).
      // ASSERT, never correct: refuse to move rather than silently place a stop the
      // config never sanctioned. The previous stop stands; the preset always protects.
      await logExec({
        level: "error",
        event: "stop.configViolatesGeometry",
        positionId,
        userBotId: position.userBotId,
        detail: { step: plan.step, distancePct: plan.distancePct, rungsFilled, note: "ladder breaches its own soundness rule (G2) — stop NOT moved" },
      });
    } else if (plan.step > position.stopStep) {
      const result = await ratchetStop({ positionId: position.id, step: plan.step, distancePct: plan.distancePct });
      stopMoved = result.moved;
      if (result.moved) {
        await logExec({
          level: "info",
          event: "stop.ratcheted",
          positionId,
          userBotId: position.userBotId,
          detail: {
            rule: plan.rule, step: plan.step, distancePct: plan.distancePct,
            stopPrice: result.stopPrice, profitLocked: plan.distancePct < 0, canceled: result.canceled.length,
          },
        });
      } else if (result.reason === "wrongSide" || result.reason === "notTighter") {
        // Normal, not an error: price retraced after a spike-fill, so the target sits
        // beyond the market. The previous generation stays live; the next sync retries.
        await logExec({
          level: "info",
          event: "stop.ratchetDeferred",
          positionId,
          userBotId: position.userBotId,
          detail: { step: plan.step, reason: result.reason, distancePct: plan.distancePct },
        });
      }
    }
  }

  // Flat on the venue → settle. This is the only place PnL is booked.
  const live = await livePosition(ex, position.symbol);
  const contracts = Number(live?.contracts ?? 0);
  if (contracts > 0) {
    // Still open — snapshot the live mark so the member's page can show unrealized PnL
    // without an exchange call of its own. Prefer the venue's own number; fall back to the
    // linear-perp formula on the REMAINING contracts. Best-effort: a failed write just leaves
    // the previous snapshot, and the next pass refreshes it.
    const mark = Number(live?.markPrice ?? live?.lastPrice ?? 0) || null;
    if (mark) {
      // `Number(null)` is 0, and 0 is finite — so a venue that simply omits the field used to
      // pin the member's page at "+$0.00" for the life of the position instead of falling
      // back. Only an actual number counts as the venue having answered.
      const venueUpnl = live?.unrealizedPnl;
      const dir = position.side === "LONG" ? 1 : -1;
      const unrealizedPnl =
        typeof venueUpnl === "number" && Number.isFinite(venueUpnl)
          ? venueUpnl
          : (mark - position.entryPrice) * contracts * dir * contractSize;
      await prisma.position
        .update({ where: { id: position.id }, data: { lastMarkPrice: mark, unrealizedPnl, markedAt: new Date() } })
        .catch(() => {});
    }
    return { positionId, rungsFilled, stopMoved, closed: false, realizedPnl: null };
  }

  // The position is gone, but OUR orders are not. When a stop fires, nothing cancels the
  // remaining take-profit limits — and a reduce-only limit left resting from THIS trade
  // would close the NEXT one at this trade's prices. `closeAll` already sweeps on an exit
  // signal; the stop-out path must sweep too. Idempotent (22001 "no order to cancel").
  if (!opts.flatten) {
    for (const params of [{}, { trigger: true }]) {
      try {
        await ex.cancelAllOrders(position.symbol, params);
      } catch {
        /* nothing of this kind was resting */
      }
    }
    // A movable stop can survive the sweeps above (on Bitget it lives in its own plan family).
    // At settle the position is already flat, so it SHOULD have died with the position — but if
    // the position closed by some other cause (TP-full, the backstop, an under-filled close)
    // while a ratchet stop still rested, it is orphaned and would bind the next same-symbol
    // trade. There is no reconcile backstop for orphan ORDERS (scanForOrphans keys on
    // contracts), so clear it explicitly.
    //
    // Safe here even on a venue where this also removes the backstop: `contracts === 0` was
    // just confirmed above, so there is no position left to leave unprotected. That is NOT true
    // in `closeAll`, which is why the ordering there is venue-dependent.
    await strategy.clearWorking(ex, position.symbol).catch(() => {});
  }

  const ourOrderIds = new Set(
    [...position.orders.map((o) => o.exchangeOrderId), closeOrderId].filter((id): id is string => Boolean(id)),
  );
  // Every clientOid we issued for this position. Deterministic by construction, so a fill can
  // still be recognised as ours when the venue answered `createOrder` without an id.
  const ourClientOids = new Set([
    ...position.orders.map((o) => o.clientOrderId),
    clientOrderId(position.entrySignalId, position.userBotId, "CLOSE"),
  ]);
  // Our STOP plan-order ids (the preset loss_plan + every ratchet pos_loss generation).
  const stopPlanIds = new Set(
    position.orders.filter((o) => o.kind === "STOP" && o.exchangeOrderId).map((o) => o.exchangeOrderId!),
  );
  const exitSide = position.side === "LONG" ? "sell" : "buy";

  const { attribution, stoppedOut, error: fillsError } = await readAttribution({
    ex,
    exchange: position.exchange,
    symbol: position.symbol,
    since: position.createdAt.getTime() - 60_000,
    ourOrderIds,
    ourClientOids,
    stopPlanIds,
    exitSide,
    positionSize: position.size,
    contractSize,
    attempts: FILL_READ_ATTEMPTS,
  });

  // THE POSITION IS GONE FROM THE VENUE AND MUST CLOSE HERE, whatever the fills say. A
  // reversal refuses to open on top of a row still marked OPEN (`reversalCloseIncomplete`),
  // so holding the row open until the arithmetic reconciles would stop the bot trading.
  //
  // What is deferred is the NUMBER, not the close. `pnlPending` says the venue had not
  // published every fill yet; `resettlePnl` re-reads on the next pass and applies the
  // difference. Until then we book the venue's own figure for the fills we could see, which
  // is short by an unpublished fill's profit — a few dollars — rather than by its notional.
  const complete = attribution?.complete === true;
  const realizedPnl = complete ? attribution!.pnl : (attribution?.venuePnl ?? 0);
  const pnlPending = !complete;

  if (complete && pnlDisagrees(attribution!)) {
    await logExec({
      level: "warn",
      event: "pnl.venueMismatch",
      positionId,
      userBotId: position.userBotId,
      detail: {
        note: "our arithmetic and the venue's own realized figure disagree — suspect a units/contract-size fault",
        ours: attribution!.pnl,
        venue: attribution!.venuePnl,
        fills: attribution!.fills,
      },
    });
  }

  if (pnlPending) {
    await logExec({
      level: "warn",
      event: "pnl.settlementDeferred",
      positionId,
      userBotId: position.userBotId,
      detail: {
        note: "the venue had not published every fill of this position yet; booked provisionally and flagged for re-settlement",
        provisional: realizedPnl,
        openedAmount: attribution?.openedAmount ?? null,
        closedAmount: attribution?.closedAmount ?? null,
        positionSize: position.size,
        fills: attribution?.fills ?? 0,
        readFailed: fillsError ? errorDetail(fillsError).message : null,
      },
    });
  }

  const allRungsFilled = rungsFilled === position.orders.filter((o) => o.kind === "TP").length;
  const reason = opts.reason ?? (stoppedOut ? "SL" : allRungsFilled ? "TP_FULL" : "RECONCILE");
  // CLAIM the close, then book off it. A reversal and the cron can both reach a position that
  // has just gone flat, and `realizedBalance` is an INCREMENT: settling twice would credit the
  // member twice. The OPEN→CLOSED transition is the claim, so only one caller can book.
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.position.updateMany({
      where: { id: position.id, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date(), closedReason: reason, realizedPnl, pnlPending, tpRungsFilled: rungsFilled },
    });
    if (claimed.count === 0) return;
    // Whatever is still marked OPEN is gone from the venue by now — the sweep above, the
    // fill itself, or the position closing took it.
    await tx.order.updateMany({
      where: { positionId: position.id, state: { in: ["OPEN", "PENDING"] } },
      data: { state: "CANCELED" },
    });
    // Compounding grows off realized PnL, so this is the number the next trade sizes from.
    await tx.userBot.update({
      where: { id: position.userBotId },
      data: { realizedBalance: { increment: realizedPnl } },
    });
  });
  await logExec({ level: "info", event: "position.closed", positionId, userBotId: position.userBotId, detail: { reason, realizedPnl, pnlPending, rungsFilled, stopStep: position.stopStep } });

  return { positionId, rungsFilled, stopMoved, closed: true, realizedPnl };
}

/**
 * Finish a close whose fills the venue had not published when it settled.
 *
 * Re-reads, re-attributes, and applies the DIFFERENCE to both the position and the
 * deployment's running balance — a difference, not an overwrite, so a pass that runs twice
 * cannot double-count and a partially-booked figure is corrected rather than stacked on.
 * Clears `pnlPending` only once the fills actually reconcile; until then it stays flagged and
 * is picked up again next pass.
 *
 * Returns null when there was nothing to do.
 */
/**
 * Re-read and attribute an already-closed position's fills. Writes nothing — shared by the
 * re-settlement pass and by the audit script, so what an operator is shown before repairing
 * is produced by exactly the code that will do the repairing.
 */
async function reattribute(position: LoadedPosition, attempts: number): Promise<Attribution | null> {
  const client = await clientFor(position);
  if (!client) return null;
  const { ex, contractSize } = client;

  const ourOrderIds = new Set(position.orders.map((o) => o.exchangeOrderId).filter((id): id is string => Boolean(id)));
  const ourClientOids = new Set([
    ...position.orders.map((o) => o.clientOrderId),
    clientOrderId(position.entrySignalId, position.userBotId, "CLOSE"),
  ]);
  const stopPlanIds = new Set(
    position.orders.filter((o) => o.kind === "STOP" && o.exchangeOrderId).map((o) => o.exchangeOrderId!),
  );

  const { attribution } = await readAttribution({
    ex,
    exchange: position.exchange,
    symbol: position.symbol,
    since: position.createdAt.getTime() - 60_000,
    ourOrderIds,
    ourClientOids,
    stopPlanIds,
    exitSide: position.side === "LONG" ? "sell" : "buy",
    positionSize: position.size,
    contractSize,
    attempts,
  });
  return attribution;
}

/**
 * What the venue says this closed position really made, against what we booked. Read-only;
 * `scripts/verify-pnl-attribution.ts` reports from it and `resettlePnl` acts on it.
 */
export async function auditPnl(positionId: string) {
  const position = await loadPosition(positionId);
  if (!position || position.status !== "CLOSED") return null;
  const attribution = await reattribute(position, 1);
  return {
    positionId,
    userBotId: position.userBotId,
    symbol: position.symbol,
    side: position.side,
    size: position.size,
    closedAt: position.closedAt,
    closedReason: position.closedReason,
    pnlPending: position.pnlPending,
    stored: position.realizedPnl,
    attributed: attribution?.complete ? attribution.pnl : null,
    venue: attribution?.venuePnl ?? null,
    complete: attribution?.complete === true,
    openedAmount: attribution?.openedAmount ?? 0,
    closedAmount: attribution?.closedAmount ?? 0,
    fills: attribution?.fills ?? 0,
  };
}

export async function resettlePnl(positionId: string): Promise<{ settled: boolean; from: number; to: number } | null> {
  const position = await loadPosition(positionId);
  if (!position || position.status !== "CLOSED" || !position.pnlPending) return null;

  // One read per pass: the cron IS the retry, once a minute, and a tight loop here would only
  // hammer the venue on a position whose missing fill may never arrive.
  const attribution = await reattribute(position, 1);

  if (!attribution?.complete) {
    // Loud once it is no longer just publication lag. A fill that never arrives means part of
    // this position was closed by something we did not place — a liquidation, or the member
    // by hand — and no arithmetic here can attribute it. Better visibly unsettled than
    // silently wrong.
    if (Date.now() - (position.closedAt?.getTime() ?? Date.now()) > PNL_STALE_AFTER_MS) {
      await logExec({
        level: "error",
        event: "pnl.settlementStalled",
        positionId,
        userBotId: position.userBotId,
        detail: {
          note: "still cannot account for every fill of this position; its realized PnL is provisional",
          booked: position.realizedPnl,
          openedAmount: attribution?.openedAmount ?? null,
          closedAmount: attribution?.closedAmount ?? null,
          positionSize: position.size,
          closedAt: position.closedAt,
        },
      });
    }
    return { settled: false, from: position.realizedPnl, to: position.realizedPnl };
  }

  const from = position.realizedPnl;
  const to = attribution.pnl;
  // CLAIM, then apply. The correction is an increment on a member's balance, so two passes
  // that both decided to settle the same position would apply it twice. Clearing the flag is
  // the claim: whoever clears it owns the increment, and the loser writes nothing at all.
  const applied = await prisma.$transaction(async (tx) => {
    const claimed = await tx.position.updateMany({
      where: { id: position.id, pnlPending: true },
      data: { realizedPnl: to, pnlPending: false },
    });
    if (claimed.count === 0) return false;
    await tx.userBot.update({
      where: { id: position.userBotId },
      data: { realizedBalance: { increment: to - from } },
    });
    return true;
  });
  if (!applied) return { settled: false, from, to: from };
  await logExec({
    level: "info",
    event: "pnl.settled",
    positionId,
    userBotId: position.userBotId,
    detail: { note: "the venue published the remaining fills; provisional figure corrected", from, to, delta: to - from, fills: attribution.fills },
  });

  return { settled: true, from, to };
}

/** Every open position for a bot, across all the members running it. */
export async function openPositionsForBot(botId: string): Promise<string[]> {
  const rows = await prisma.position.findMany({
    where: { status: "OPEN", userBot: { botId } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
