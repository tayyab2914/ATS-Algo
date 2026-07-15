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
import { exchangeClient, getMarket, type TradeCreds } from "./client";
import { clientOrderId, closeAll, ratchetStop } from "./execute";
import { logExec } from "./log";
import type { Side } from "./pricing";

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

/**
 * `sell` proceeds minus `buy` cost, minus fees — correct for a long (bought then
 * sold) and for a short (sold then bought) alike. Also reports how much of the
 * position each side actually closed, so incomplete attribution can be detected.
 */
function summarizeTrades(trades: Trades, exitSide: "buy" | "sell", ourOrderIds: Set<string> | null) {
  let pnl = 0;
  let closedAmount = 0;
  let matched = 0;
  for (const trade of trades) {
    if (ourOrderIds && (!trade.order || !ourOrderIds.has(trade.order))) continue;
    matched++;
    const amount = Number(trade.amount);
    pnl += (trade.side === "sell" ? 1 : -1) * Number(trade.price) * amount;
    pnl -= Number(trade.fee?.cost ?? 0);
    if (trade.side === exitSide) closedAmount += amount;
  }
  return { pnl, closedAmount, matched };
}

/**
 * Realized PnL from the venue's own fills, matched to the orders we placed — so a
 * member who also trades by hand on the same account cannot bleed fills into a
 * bot's PnL.
 *
 * The catch: if a closing fill belongs to an order id we never captured (a
 * liquidation, say), matching alone sees only the entry and returns roughly
 * `-entryValue`. That number would then be added to `realizedBalance` and used to
 * size the member's next trade. So we check that the matched fills actually closed
 * the position; when they don't, we widen to every fill on the symbol in this
 * position's lifetime and say so loudly, because that is the lesser error.
 */
async function realizedPnlFor(
  trades: Trades,
  exitSide: "buy" | "sell",
  ourOrderIds: Set<string>,
  positionSize: number,
  positionId: string,
): Promise<number> {
  const matched = summarizeTrades(trades, exitSide, ourOrderIds);
  const accountedFor = Math.abs(matched.closedAmount - positionSize) <= positionSize * 0.01;
  if (accountedFor) return matched.pnl;

  const all = summarizeTrades(trades, exitSide, null);
  await logExec({
    level: "warn",
    event: "pnl.attributionIncomplete",
    positionId,
    detail: {
      note: "a closing fill belonged to an order we never recorded; widened to every fill on this symbol",
      matchedClose: matched.closedAmount,
      positionSize,
      matchedPnl: matched.pnl,
      widenedPnl: all.pnl,
    },
  });
  return all.pnl;
}

async function clientFor(position: LoadedPosition): Promise<{ ex: Exchange; creds: TradeCreds } | null> {
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
  return { ex: await exchangeClient(position.exchange, creds, [market]), creds };
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
  const { ex } = client;

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

  // Which of our orders are still resting? Anything of ours that is gone has either
  // filled or been cancelled, and only the venue can say which. The `profit_loss` pass is
  // required: a live movable pos_loss (and the preset) is in neither {} nor {trigger:true},
  // so without it a live pos_loss STOP row reads as "not resting" and falls to fetchOrder by
  // bare id below — which cannot address a TPSL and can mis-mark the row while it is still live.
  const restingIds = new Set<string>();
  for (const params of [{}, { trigger: true }, { planType: "profit_loss" }]) {
    try {
      for (const order of await ex.fetchOpenOrders(position.symbol, undefined, undefined, params)) {
        if (order.id) restingIds.add(order.id);
      }
    } catch {
      /* nothing of this kind */
    }
  }

  for (const order of position.orders) {
    const terminal = order.state === "FILLED" || order.state === "CANCELED" || order.state === "REJECTED";
    if (terminal || !order.exchangeOrderId || restingIds.has(order.exchangeOrderId)) continue;
    try {
      const live = await ex.fetchOrder(order.exchangeOrderId, position.symbol);
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
  const livePosition = (await ex.fetchPositions([position.symbol]))[0];
  const contracts = Number(livePosition?.contracts ?? 0);
  if (contracts > 0) {
    // Still open — snapshot the live mark so the member's page can show unrealized PnL
    // without an exchange call of its own. Prefer the venue's own number; fall back to the
    // linear-perp formula on the REMAINING contracts. Best-effort: a failed write just leaves
    // the previous snapshot, and the next pass refreshes it.
    const mark = Number(livePosition?.markPrice ?? livePosition?.lastPrice ?? 0) || null;
    if (mark) {
      const venueUpnl = Number(livePosition?.unrealizedPnl);
      const dir = position.side === "LONG" ? 1 : -1;
      const unrealizedPnl = Number.isFinite(venueUpnl) ? venueUpnl : (mark - position.entryPrice) * contracts * dir;
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
    // A movable pos_loss survives the sweeps above (profit_loss family). At settle the position
    // is already flat, so it SHOULD have died with the position — but if the position closed by
    // some other cause (TP-full, the preset, an under-filled close) while a ratchet pos_loss
    // still rested, it is orphaned and would bind the next same-symbol trade. There is no
    // reconcile backstop for orphan ORDERS (scanForOrphans keys on contracts), so cancel by id.
    try {
      for (const order of await ex.fetchOpenOrders(position.symbol, undefined, undefined, { planType: "profit_loss" })) {
        if ((order.info as { planType?: string } | undefined)?.planType === "pos_loss" && order.id) {
          await ex.cancelOrder(order.id, position.symbol, { planType: "pos_loss", trigger: true }).catch(() => {});
        }
      }
    } catch {
      /* nothing resting */
    }
  }

  const ourOrderIds = new Set(
    [...position.orders.map((o) => o.exchangeOrderId), closeOrderId].filter((id): id is string => Boolean(id)),
  );
  // Our STOP plan-order ids (the preset loss_plan + every ratchet pos_loss generation).
  const stopPlanIds = new Set(
    position.orders.filter((o) => o.kind === "STOP" && o.exchangeOrderId).map((o) => o.exchangeOrderId!),
  );
  const exitSide = position.side === "LONG" ? "sell" : "buy";
  let realizedPnl = 0;
  let stoppedOut = false;
  try {
    const since = position.createdAt.getTime() - 60_000;
    const trades = await ex.fetchMyTrades(position.symbol, since, 100);

    // Attribute a stop-out. When a pos_loss/preset TPSL fires, Bitget executes it with a
    // CHILD market order minted on trigger: the fill carries the CHILD's id, not the plan-order
    // id we recorded — but the child's clientOid IS that plan-order id (proven on the venue).
    // So resolve any exit-side fill we don't already own; if its order's clientOid is one of
    // our stop plan ids, it was a stop-out. Fold the child id into ourOrderIds BEFORE booking
    // PnL, so the close attributes cleanly instead of taking the widened (contamination-prone)
    // path. If it can't be resolved, `stoppedOut` stays false and the reason simply degrades to
    // RECONCILE — never a wrong number, just a less specific label.
    for (const t of trades) {
      if (t.side !== exitSide || !t.order || ourOrderIds.has(t.order) || stopPlanIds.has(t.order)) continue;
      try {
        const child = await ex.fetchOrder(t.order, position.symbol);
        const childOid = child.clientOrderId ?? (child.info as { clientOid?: string } | undefined)?.clientOid;
        if (childOid && stopPlanIds.has(childOid)) {
          ourOrderIds.add(t.order);
          stoppedOut = true;
        }
      } catch {
        /* unresolved; the close simply books as RECONCILE rather than SL */
      }
    }

    realizedPnl = await realizedPnlFor(trades, exitSide, ourOrderIds, position.size, position.id);

    // Belt-and-braces: some venues DO carry the plan-order id directly on the fill.
    if (!stoppedOut) {
      stoppedOut = trades.some((t) => t.side === exitSide && t.order && stopPlanIds.has(t.order));
    }
  } catch {
    /* leave at 0 rather than invent a number; the cron will retry */
  }

  const allRungsFilled = rungsFilled === position.orders.filter((o) => o.kind === "TP").length;
  const reason = opts.reason ?? (stoppedOut ? "SL" : allRungsFilled ? "TP_FULL" : "RECONCILE");
  await prisma.$transaction([
    prisma.position.update({
      where: { id: position.id },
      data: { status: "CLOSED", closedAt: new Date(), closedReason: reason, realizedPnl, tpRungsFilled: rungsFilled },
    }),
    // Whatever is still marked OPEN is gone from the venue by now — the sweep above, the
    // fill itself, or the position closing took it.
    prisma.order.updateMany({
      where: { positionId: position.id, state: { in: ["OPEN", "PENDING"] } },
      data: { state: "CANCELED" },
    }),
    // Compounding grows off realized PnL, so this is the number the next trade sizes from.
    prisma.userBot.update({
      where: { id: position.userBotId },
      data: { realizedBalance: { increment: realizedPnl } },
    }),
  ]);
  await logExec({ level: "info", event: "position.closed", positionId, userBotId: position.userBotId, detail: { reason, realizedPnl, rungsFilled, stopStep: position.stopStep } });

  return { positionId, rungsFilled, stopMoved, closed: true, realizedPnl };
}

/** Every open position for a bot, across all the members running it. */
export async function openPositionsForBot(botId: string): Promise<string[]> {
  const rows = await prisma.position.findMany({
    where: { status: "OPEN", userBot: { botId } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
