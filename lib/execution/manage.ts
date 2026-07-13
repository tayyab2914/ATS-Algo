import "server-only";
import type { Exchange } from "ccxt";
import { beRungIndex, profileFor, type BotConfig } from "@/lib/bot-config";
import { prisma } from "@/lib/db";
import { getDecryptedConnection } from "@/lib/exchanges/connection";
import { exchangeClient, getMarket, type TradeCreds } from "./client";
import { clientOrderId, closeAll, moveStopToBreakEven } from "./execute";
import { logExec } from "./log";

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
  beArmed: boolean;
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
    return { positionId, rungsFilled: 0, beArmed: false, closed: true, realizedPnl: null };
  }

  const profile = profileFor(position.userBot.bot.config as unknown as BotConfig, position.userBot.bot.riskClass);
  const client = await clientFor(position);
  if (!client) {
    await logExec({ level: "warn", event: "sync.noConnection", positionId, userBotId: position.userBotId });
    return { positionId, rungsFilled: position.tpRungsFilled, beArmed: false, closed: false, realizedPnl: null };
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
  // filled or been cancelled, and only the venue can say which.
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

  // Break-even arms on the fill of ONE SPECIFIC rung, never on a count: the ladder
  // is not always ascending, so rung 2 can fill before rung 1.
  let beArmed = false;
  const beIndex = profile ? beRungIndex(profile) : null;
  if (beIndex !== null && !position.beMoved) {
    const beRung = position.orders.find((o) => o.kind === "TP" && o.rungIndex === beIndex);
    if (beRung?.state === "FILLED") {
      beArmed = await moveStopToBreakEven(position.id);
      if (beArmed) await logExec({ level: "info", event: "stop.movedToBreakEven", positionId, userBotId: position.userBotId, detail: { rungIndex: beIndex } });
    }
  }

  // Flat on the venue → settle. This is the only place PnL is booked.
  const contracts = Number((await ex.fetchPositions([position.symbol]))[0]?.contracts ?? 0);
  if (contracts > 0) {
    return { positionId, rungsFilled, beArmed, closed: false, realizedPnl: null };
  }

  const ourOrderIds = new Set(
    [...position.orders.map((o) => o.exchangeOrderId), closeOrderId].filter((id): id is string => Boolean(id)),
  );
  const exitSide = position.side === "LONG" ? "sell" : "buy";
  let realizedPnl = 0;
  try {
    const since = position.createdAt.getTime() - 60_000;
    const trades = await ex.fetchMyTrades(position.symbol, since, 100);
    realizedPnl = await realizedPnlFor(trades, exitSide, ourOrderIds, position.size, position.id);
  } catch {
    /* leave at 0 rather than invent a number; the cron will retry */
  }

  const reason = opts.reason ?? (rungsFilled === position.orders.filter((o) => o.kind === "TP").length ? "TP_FULL" : "RECONCILE");
  await prisma.$transaction([
    prisma.position.update({
      where: { id: position.id },
      data: { status: "CLOSED", closedAt: new Date(), closedReason: reason, realizedPnl, tpRungsFilled: rungsFilled },
    }),
    // Compounding grows off realized PnL, so this is the number the next trade sizes from.
    prisma.userBot.update({
      where: { id: position.userBotId },
      data: { realizedBalance: { increment: realizedPnl } },
    }),
  ]);
  await logExec({ level: "info", event: "position.closed", positionId, userBotId: position.userBotId, detail: { reason, realizedPnl, rungsFilled } });

  return { positionId, rungsFilled, beArmed, closed: true, realizedPnl };
}

/** Every open position for a bot, across all the members running it. */
export async function openPositionsForBot(botId: string): Promise<string[]> {
  const rows = await prisma.position.findMany({
    where: { status: "OPEN", userBot: { botId } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
