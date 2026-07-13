import "server-only";
import { prisma } from "@/lib/db";
import { chosenExchange } from "@/lib/bot-exchanges";
import { getDecryptedConnection } from "@/lib/exchanges/connection";
import { exchangeClient, refreshMarketCache, type TradeCreds } from "./client";
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
  beArmed: number;
  errors: number;
};

/**
 * The per-minute pass. For every open position: read its true state, mark filled
 * rungs, arm break-even if the configured rung has filled, and settle it if the
 * venue shows it flat.
 *
 * Costs one `fetchPositions` per open position in the common case where nothing
 * happened. With no open positions it costs a single database query.
 *
 * Oldest-touched first, so a large backlog drains fairly across invocations
 * instead of the same few positions being re-checked every minute.
 */
export async function reconcileOpenPositions(limit = DEFAULT_LIMIT): Promise<ReconcileResult> {
  const positions = await prisma.position.findMany({
    where: { status: "OPEN" },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const result: ReconcileResult = { scanned: positions.length, closed: 0, beArmed: 0, errors: 0 };
  if (positions.length === 0) return result;

  const outcomes = await inChunks(positions, CHUNK, (p) => syncPosition(p.id));
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      result.errors++;
      await logExec({ level: "error", event: "reconcile.failed", detail: errorDetail(outcome.reason) });
      continue;
    }
    if (outcome.value.closed) result.closed++;
    if (outcome.value.beArmed) result.beArmed++;
  }

  if (result.closed || result.beArmed || result.errors) {
    await logExec({ level: "info", event: "reconcile.pass", detail: { ...result } });
  }
  return result;
}

export type OrphanResult = { checked: number; orphans: number };

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

  const result: OrphanResult = { checked: 0, orphans: 0 };

  const outcomes = await inChunks(deployments, CHUNK, async (deployment) => {
    const chosen = chosenExchange(deployment.exchangeSource, deployment.bot.exchanges);
    if (!chosen || chosen !== "Bitget") return false;

    const connection = await getDecryptedConnection(deployment.userId, chosen);
    if (!connection) return false;

    const creds: TradeCreds = {
      apiKey: connection.apiKey, apiSecret: connection.apiSecret,
      passphrase: connection.passphrase, sandbox: connection.sandbox,
    };
    const { symbol, market } = await resolveSymbol(chosen, deployment.bot.ticker, creds.sandbox);
    const ex = await exchangeClient(chosen, creds, [market]);
    const contracts = Number((await ex.fetchPositions([symbol]))[0]?.contracts ?? 0);
    result.checked++;
    if (contracts <= 0) return false;

    await logExec({
      level: "warn", event: "reconcile.orphan", userBotId: deployment.id,
      detail: { symbol, contracts, sandbox: creds.sandbox, note: "position on the venue with no row; not closed automatically" },
    });
    return true;
  });

  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled" && outcome.value) result.orphans++;
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
