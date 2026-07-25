import "server-only";
import { profileFor, snapshotProfile, type BotConfig } from "@/lib/bot-config";
import { chosenExchange } from "@/lib/bot-exchanges";
import { prisma } from "@/lib/db";
import { getDecryptedConnection } from "@/lib/exchanges/connection";
import { botReadiness } from "@/lib/my-bots/readiness";
import { publicPrice, type TradeCreds } from "./client";
import { executionError, openPosition } from "./execute";
import { errorDetail, logExec } from "./log";
import { openPositionsForBot, syncPosition } from "./manage";
import type { Side } from "./pricing";
import { resolveSymbol } from "./symbol";

/**
 * One signal, many members.
 *
 * The core is deliberately transport-agnostic: the TradingView receiver and the
 * admin panel both build a `Signal` row and call `fanOut`. Each member is executed
 * in isolation — one bad API key, one under-funded account, one venue error must
 * never stop everyone else's bot from trading.
 */

/** Flip to "1" to make every signal a no-op without redeploying. */
export const killSwitchOn = () => process.env.SIGNALS_KILL_SWITCH === "1";

/** Concurrency cap: Supabase's pooler is sized at DATABASE_POOL_MAX (default 5). */
const CHUNK = 3;

export type Skip = { userBotId: string; reason: string };
export type Failure = { userBotId: string; message: string };

export type FanOutResult = {
  action: string;
  placed: string[];
  skipped: Skip[];
  failed: Failure[];
  /** Positions touched by a tp/exit signal. */
  synced: number;
  closed: number;
};

/**
 * How many of a bot's active deployments would trade REAL money right now: armed
 * for live *and* holding a non-sandbox key. Zero means a dispatch can only ever
 * touch paper. The admin panel confirms against this number before firing.
 */
export async function liveDeploymentCount(botId: string): Promise<number> {
  const armed = await prisma.userBot.findMany({
    where: { botId, active: true, liveArmed: true },
    select: { userId: true },
  });
  if (armed.length === 0) return 0;

  return prisma.exchangeConnection.count({
    where: { userId: { in: armed.map((a) => a.userId) }, exchange: "Bitget", sandbox: false },
  });
}

function loadSignal(signalId: string) {
  return prisma.signal.findUnique({
    where: { id: signalId },
    include: { bot: { select: { id: true, status: true, ticker: true, riskClass: true, config: true, exchanges: true } } },
  });
}
type LoadedSignal = NonNullable<Awaited<ReturnType<typeof loadSignal>>>;

async function inChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.allSettled(items.slice(i, i + size).map(fn))));
  }
  return results;
}

export async function fanOut(signalId: string): Promise<FanOutResult> {
  const empty: FanOutResult = { action: "", placed: [], skipped: [], failed: [], synced: 0, closed: 0 };
  if (killSwitchOn()) {
    await logExec({ level: "warn", event: "fanout.killSwitch", signalId });
    return empty;
  }

  const signal = await loadSignal(signalId);
  if (!signal) return empty;
  const result: FanOutResult = { ...empty, action: signal.action };

  if (signal.bot.status !== "ACTIVE") {
    await logExec({ level: "warn", event: "fanout.skip.botDisabled", botId: signal.botId, signalId });
    return result;
  }

  if (signal.action === "ENTER") return enterAll(signal, result);

  // `tp` and `exit` act on whatever is already open. A tp alert is only a nudge to
  // re-read fills — the take-profit prices come from the bot's config, not from
  // TradingView, so a tp alert never means "rung N filled" on its own.
  const positionIds = await openPositionsForBot(signal.botId);
  const flatten = signal.action === "EXIT";
  const outcomes = await inChunks(positionIds, CHUNK, (id) => syncPosition(id, flatten ? { flatten: true, reason: "EXIT" } : {}));
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      await logExec({ level: "error", event: "fanout.sync.failed", botId: signal.botId, signalId, detail: errorDetail(outcome.reason) });
      continue;
    }
    result.synced++;
    if (outcome.value.closed) result.closed++;
  }
  return result;
}


async function enterAll(signal: LoadedSignal, result: FanOutResult): Promise<FanOutResult> {
  const side = (signal.side ?? "LONG") as Side;

  // The alert carries no price. TradingView substitutes nothing into an
  // indicator's webhook body — not even its own `{{close}}` — so asking for one
  // only ever produced a literal placeholder and a rejected entry. Read the
  // venue's last trade instead, exactly as an admin dispatch does. A payload that
  // does carry a usable number still wins: the admin panel sends one.
  const raw = signal.raw as { price?: string | number } | null;
  let priceHint = Number(raw?.price);
  if (!Number.isFinite(priceHint) || priceHint <= 0) {
    try {
      const { symbol } = await resolveSymbol("Bitget", signal.bot.ticker, false);
      priceHint = await publicPrice("Bitget", symbol);
      await logExec({ level: "info", event: "fanout.pricedFromVenue", botId: signal.botId, signalId: signal.id, detail: { symbol, price: priceHint } });
    } catch (error) {
      await logExec({ level: "error", event: "fanout.noPrice", botId: signal.botId, signalId: signal.id, detail: errorDetail(error) });
      return result;
    }
  }

  const botConfig = signal.bot.config as unknown as BotConfig;
  const profile = profileFor(botConfig, signal.bot.riskClass);
  if (!profile) {
    await logExec({ level: "error", event: "fanout.noProfile", botId: signal.botId, signalId: signal.id, detail: { riskClass: signal.bot.riskClass } });
    return result;
  }
  // Freeze the rules every position opened by THIS signal will live by, so an admin
  // editing the bot mid-trade can never move the stop under an open position.
  const snapshot = snapshotProfile(botConfig, profile);

  const deployments = await prisma.userBot.findMany({
    where: { botId: signal.botId, active: true },
    select: {
      id: true, userId: true, exchangeSource: true, exchangePrepared: true, liveArmed: true,
      allocationType: true, capitalPerTrade: true, allocatedCapital: true, compounding: true, realizedBalance: true,
    },
  });

  const outcomes = await inChunks(deployments, CHUNK, async (deployment) => {
    const skip = async (reason: string): Promise<Skip> => {
      await logExec({ level: "info", event: `fanout.skip.${reason}`, botId: signal.botId, userBotId: deployment.id, signalId: signal.id });
      return { userBotId: deployment.id, reason };
    };

    const chosen = chosenExchange(deployment.exchangeSource, signal.bot.exchanges);
    if (!chosen) return skip("noExchangeChosen");
    if (chosen !== "Bitget") return skip("exchangeNotWired");

    const connection = await getDecryptedConnection(deployment.userId, chosen);
    if (!connection) return skip("noConnection");

    const { ready } = botReadiness({
      exchanges: signal.bot.exchanges,
      chosen,
      connected: true,
      capitalPerTrade: deployment.capitalPerTrade,
    });
    if (!ready) return skip("notReady");

    // ── The gate that protects real money ────────────────────────────────────
    // A webhook has nobody to click "confirm". A live key trades only when the
    // member has deliberately armed this deployment. Sandbox is paper money and
    // always proceeds. Never inferred, never implicit.
    if (!connection.sandbox && !deployment.liveArmed) return skip("liveNotArmed");

    // SWING BOT · ONE-WAY MODE (no hedge): a new entry REPLACES the current
    // position. Close any position this deployment already holds first — booking
    // its realized PnL exactly like an exit — then open the new one. We never hold
    // two at once, and never stack a new entry on top of one we failed to close.
    let realizedBalance = deployment.realizedBalance;
    const openPrior = await prisma.position.findMany({
      where: { userBotId: deployment.id, status: "OPEN" },
      select: { id: true },
    });
    if (openPrior.length > 0) {
      for (const prior of openPrior) {
        const closed = await syncPosition(prior.id, { flatten: true, reason: "REVERSAL" });
        await logExec({
          level: "info", event: "position.reversed", botId: signal.botId, userBotId: deployment.id,
          signalId: signal.id, positionId: prior.id,
          detail: { closed: closed.closed, realizedPnl: closed.realizedPnl, newSide: side },
        });
      }
      // Refuse to open on top of a position we couldn't flatten — that would be
      // hedge mode. The reconcile cron finishes the close; the next signal retries.
      const stillOpen = await prisma.position.count({ where: { userBotId: deployment.id, status: "OPEN" } });
      if (stillOpen > 0) return skip("reversalCloseIncomplete");
      // Compounding sizes off the balance AFTER the reversal booked its PnL.
      const fresh = await prisma.userBot.findUnique({ where: { id: deployment.id }, select: { realizedBalance: true } });
      realizedBalance = fresh?.realizedBalance ?? realizedBalance;
    }

    const creds: TradeCreds = {
      apiKey: connection.apiKey,
      apiSecret: connection.apiSecret,
      passphrase: connection.passphrase,
      sandbox: connection.sandbox,
    };
    const { symbol, market, requested, substituted } = await resolveSymbol(chosen, signal.bot.ticker, creds.sandbox);
    if (substituted) {
      await logExec({
        level: "warn", event: "symbol.substituted", botId: signal.botId, userBotId: deployment.id, signalId: signal.id,
        detail: { requested, traded: symbol, note: "instrument absent from the paper venue" },
      });
    }

    const opened = await openPosition({
      signalId: signal.id, userBotId: deployment.id, userId: deployment.userId,
      exchange: chosen, creds, symbol, market, requestedSymbol: requested, substituted,
      side, profile, snapshot,
      sizing: {
        allocationType: deployment.allocationType,
        capitalPerTrade: deployment.capitalPerTrade,
        allocatedCapital: deployment.allocatedCapital,
        realizedBalance,
        compounding: deployment.compounding,
      },
      priceHint,
      prepared: deployment.exchangePrepared,
    });

    await logExec({
      level: "info", event: "position.opened", botId: signal.botId, userBotId: deployment.id,
      signalId: signal.id, positionId: opened.positionId,
      detail: { symbol, side, size: opened.size, entryPrice: opened.entryPrice, rungsPlaced: opened.rungsPlaced, sandbox: creds.sandbox },
    });
    return { positionId: opened.positionId };
  });

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    const deployment = deployments[i];
    if (outcome.status === "rejected") {
      const { message } = executionError(outcome.reason);
      result.failed.push({ userBotId: deployment.id, message });
      // Keep both: the member-facing message and the venue's raw error.
      await logExec({ level: "error", event: "position.failed", botId: signal.botId, userBotId: deployment.id, signalId: signal.id, detail: { userMessage: message, cause: errorDetail(outcome.reason).message } });
    } else if ("reason" in outcome.value) {
      result.skipped.push(outcome.value);
    } else {
      result.placed.push(outcome.value.positionId);
    }
  }
  return result;
}
