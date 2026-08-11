import "server-only";
import { prisma } from "@/lib/db";
import { chosenExchange, exchangeEnabled } from "@/lib/bot-exchanges";
import { getDecryptedConnection } from "@/lib/exchanges/connection";
import { exchangeClient, livePosition, refreshMarketCache, type TradeCreds } from "./client";
import { errorDetail, logExec } from "./log";
import { syncPosition } from "./manage";
import { resolveSymbol } from "./symbol";

/**
 * Reconciliation: the layer that makes the engine *correct*, as opposed to fast.
 *
 * Our take-profit rungs and our stop rest on Bitget's book, and Bitget never calls
 * us. Worse, four of the five ways a position can end produce no webhook at all —
 * a break-even stop firing, the preset backstop firing, the ladder filling out, or
 * a liquidation. TradingView cannot tell us either: the indicator has no
 * break-even concept, so it does not know that stop exists.
 *
 * Left unreconciled, a stopped-out position stays `OPEN` in our database forever,
 * and `fanOut` skips every future entry for that member with `positionAlreadyOpen`.
 * The bot silently stops trading. That is the failure this file prevents.
 *
 * Everything here is idempotent and reads the venue as the source of truth, so it
 * is safe to run on a timer, twice at once, or from a WebSocket event later.
 */

/** Bounded so one slow member can't starve the rest of a cron invocation. */
const CHUNK = 3;
const DEFAULT_LIMIT = 60;

async function inChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.allSettled(items.slice(i, i + size).map(fn))));
  }
  return out;
}

export type ReconcileResult = {
  scanned: number;
  closed: number;
  /** Working stops that advanced a ratchet generation this pass. */
  stopsMoved: number;
  errors: number;
};

/**
 * The per-minute pass. For every open position: read its true state, mark filled
 * rungs, ratchet the stop if a rung has filled, and settle it if the venue shows it flat.
 *
 * Costs one `fetchPositions` per open position in the common case where nothing
 * happened. With no open positions it costs a single database query.
 *
 * Oldest-touched first, so a large backlog drains fairly across invocations
 * instead of the same few positions being re-checked every minute.
 *
 * NOT gated by SIGNALS_KILL_SWITCH — by deliberate design. The kill switch freezes NEW
 * entries (`fanOut`); it must never freeze this pass, because everything it does is
 * risk-REDUCING: tightening a stop, settling a closed position, booking PnL. The money is
 * already committed at entry, so a frozen ratchet would strand open positions with only the
 * original `sl%` preset and no profit-lock — the opposite of what a kill switch is for. This
 * is the same principle as exits never being gated. NOTE the blast radius is real now: the
 * ratchet places `pos_loss` stops that actually fire (before the pos_loss fix it placed
 * reduce-only plan stops that were starved and never fired), so an operator flipping the kill
 * switch during a venue incident will still see positions ratcheted and stopped out. If the
 * intent ever changes to "freeze ALL venue writes", gate the `ratchetStop` PLACEMENT only —
 * never settlement or attribution, which must always run.
 */
export async function reconcileOpenPositions(limit = DEFAULT_LIMIT): Promise<ReconcileResult> {
  const positions = await prisma.position.findMany({
    where: { status: "OPEN" },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const result: ReconcileResult = { scanned: positions.length, closed: 0, stopsMoved: 0, errors: 0 };
  if (positions.length === 0) return result;

  const outcomes = await inChunks(positions, CHUNK, (p) => syncPosition(p.id));
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      result.errors++;
      await logExec({ level: "error", event: "reconcile.failed", detail: errorDetail(outcome.reason) });
      continue;
    }
    if (outcome.value.closed) result.closed++;
    if (outcome.value.stopMoved) result.stopsMoved++;
  }

  if (result.closed || result.stopsMoved || result.errors) {
    await logExec({ level: "info", event: "reconcile.pass", detail: { ...result } });
  }
  return result;
}

export type OrphanResult = {
  /** Deployments actually READ from a venue. */
  checked: number;
  orphans: number;
  /**
   * Deployments NOT read, by reason — so a pass that swept almost nothing can never be
   * mistaken for an all-clear. This used to be invisible: the venue gate returned before
   * `checked` was incremented, so a fleet of unwired deployments reported
   * `{ checked: 0, orphans: 0 }` — indistinguishable from a clean sweep. On an unwired
   * venue an orphan is money committed with nothing managing it, and it was not even
   * being logged.
   */
  skipped: { noExchangeChosen: number; venueNotWired: number; noConnection: number };
};

/**
 * Find positions the exchange holds that we have no row for.
 *
 * These come from a crash between `createOrder` and `prisma.position.create`: the
 * money is committed, but nothing is managing it — no ladder tracking, no
 * break-even, no exit. A WebSocket cannot find these, because at the moment they
 * were created nothing was listening. Only asking the venue "what do I actually
 * hold?" reveals them.
 *
 * We do not auto-close them: an orphan may be the member's own manual trade. It is
 * reported loudly and left to a human.
 *
 * One `fetchPositions` per active deployment that has no open position row, so this
 * belongs on a slow schedule, not the per-minute pass.
 */
export async function scanForOrphans(limit = 50): Promise<OrphanResult> {
  const deployments = await prisma.userBot.findMany({
    where: { active: true, positions: { none: { status: "OPEN" } } },
    take: limit,
    select: { id: true, userId: true, exchangeSource: true, bot: { select: { ticker: true, exchanges: true } } },
  });

  const result: OrphanResult = {
    checked: 0,
    orphans: 0,
    skipped: { noExchangeChosen: 0, venueNotWired: 0, noConnection: 0 },
  };

  const outcomes = await inChunks(deployments, CHUNK, async (deployment) => {
    const chosen = chosenExchange(deployment.exchangeSource, deployment.bot.exchanges);
    if (!chosen) {
      result.skipped.noExchangeChosen++;
      return false;
    }
    // The venue registry, not a venue name — the same predicate the executor and the
    // connect surface read, so this can never disagree with what a member was allowed
    // to configure.
    if (!exchangeEnabled(chosen)) {
      result.skipped.venueNotWired++;
      return false;
    }

    const connection = await getDecryptedConnection(deployment.userId, chosen);
    if (!connection) {
      result.skipped.noConnection++;
      return false;
    }

    const creds: TradeCreds = {
      apiKey: connection.apiKey, apiSecret: connection.apiSecret,
      passphrase: connection.passphrase, sandbox: connection.sandbox,
    };
    const { symbol, market } = await resolveSymbol(chosen, deployment.bot.ticker, creds.sandbox);
    const ex = await exchangeClient(chosen, creds, [market]);
    const contracts = Number((await livePosition(ex, symbol))?.contracts ?? 0);
    result.checked++;
    if (contracts <= 0) return false;

    await logExec({
      level: "warn", event: "reconcile.orphan", userBotId: deployment.id,
      detail: { symbol, contracts, sandbox: creds.sandbox, exchange: chosen, note: "position on the venue with no row; not closed automatically" },
    });
    return true;
  });

  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled" && outcome.value) result.orphans++;
  }

  // A deployment on an unwired venue is a BLIND SPOT, not a clean result: it may hold a
  // position nothing is managing, and this scan cannot see it. Say so, once per pass.
  if (result.skipped.venueNotWired > 0) {
    await logExec({
      level: "warn",
      event: "reconcile.orphanScanBlindSpot",
      detail: {
        venueNotWired: result.skipped.venueNotWired,
        note: "active deployments on a venue the engine cannot read; orphans there are undetectable",
      },
    });
  }
  return result;
}

/**
 * Re-read the market descriptors we have cached. Precision, minimum size and
 * contract size do change, and a stale descriptor silently mis-sizes orders.
 * Slow (a full `loadMarkets` per venue and mode), so it belongs off the hot path.
 */
export async function refreshCachedMarkets(): Promise<{ refreshed: number }> {
  const cached = await prisma.marketCache.findMany({ select: { exchange: true, symbol: true, sandbox: true } });
  const byVenue = new Map<string, { exchange: string; sandbox: boolean; symbols: string[] }>();
  for (const row of cached) {
    const key = `${row.exchange}:${row.sandbox}`;
    const entry = byVenue.get(key) ?? { exchange: row.exchange, sandbox: row.sandbox, symbols: [] };
    entry.symbols.push(row.symbol);
    byVenue.set(key, entry);
  }

  let refreshed = 0;
  for (const { exchange, sandbox, symbols } of byVenue.values()) {
    try {
      refreshed += (await refreshMarketCache(exchange, sandbox, symbols)).length;
    } catch (error) {
      await logExec({ level: "warn", event: "reconcile.marketRefreshFailed", detail: { exchange, sandbox, ...errorDetail(error) } });
    }
  }
  return { refreshed };
}
