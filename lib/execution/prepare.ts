import "server-only";
import type { MarketInterface } from "ccxt";
import { profileFor, type BotConfig } from "@/lib/bot-config";
import { chosenExchange } from "@/lib/bot-exchanges";
import { prisma } from "@/lib/db";
import { getDecryptedConnection } from "@/lib/exchanges/connection";
import { exchangeClient, type TradeCreds } from "./client";
import { resolveSymbol } from "./symbol";

/**
 * Account settings a position depends on — one-way position mode, cross margin,
 * and the profile's leverage — applied once and remembered, instead of on every
 * order.
 *
 * Each is a REST round-trip. Doing them per trade added three of them ahead of
 * the entry, which is exactly the latency that turns a 0.30% take-profit target
 * into a worse fill. `ensurePrepared` costs nothing once the fingerprint matches.
 */

/**
 * Must be "cross", not "crossed". ccxt's `setMarginMode` accepts either spelling,
 * but `createOrder` compares against "cross" exactly and sends `isolated` for
 * anything else — so "crossed" silently opens every position isolated, at the
 * venue's default leverage rather than the profile's.
 */
export const MARGIN_MODE = "cross";

/**
 * The settings a prepared account is carrying. Compared, not parsed — any change
 * to venue, mode, instrument or leverage yields a different string and re-prepares.
 */
export const preparedKey = (exchange: string, sandbox: boolean, symbol: string, leverage: number): string =>
  `${exchange}|${sandbox ? "demo" : "live"}|${symbol}|${leverage}`;

export type PrepareInput = {
  userBotId: string;
  exchange: string;
  creds: TradeCreds;
  symbol: string;
  market: MarketInterface;
  leverage: number;
  /** `UserBot.exchangePrepared` as last stored. */
  prepared: string | null;
};

/**
 * Make the exchange account match this deployment, if it doesn't already.
 * Returns true when it actually talked to the venue.
 *
 * Safe to call on the order path: when the fingerprint matches it does no I/O at
 * all, and it is idempotent when it doesn't.
 */
export async function ensurePrepared(input: PrepareInput): Promise<boolean> {
  const key = preparedKey(input.exchange, input.creds.sandbox, input.symbol, input.leverage);
  if (input.prepared === key) return false;

  const ex = await exchangeClient(input.exchange, input.creds, [input.market]);

  // Bitget defaults to hedge mode, which rejects one-way orders (err 40774). It
  // throws once the account is already one-way, or when a position/order exists
  // (err 40920) — by which point it is one-way anyway.
  try {
    await ex.setPositionMode(false, input.symbol);
  } catch {
    /* already one-way, or an open position/order pins it there */
  }

  // These two are safe to repeat with the same value; they will reject while a
  // position is open, which is correct — leverage must not change under a trade.
  await ex.setMarginMode(MARGIN_MODE, input.symbol);
  await ex.setLeverage(input.leverage, input.symbol);

  await prisma.userBot.update({ where: { id: input.userBotId }, data: { exchangePrepared: key } });
  return true;
}

/**
 * Forget the fingerprint so the next order re-applies the settings. Only needed
 * when something outside the fingerprint changes (e.g. the API key is replaced);
 * leverage, symbol, venue and mode changes invalidate themselves.
 */
export async function clearPrepared(userBotId: string): Promise<void> {
  await prisma.userBot.update({ where: { id: userBotId }, data: { exchangePrepared: null } });
}

export type PrepareResult =
  | { prepared: true; contacted: boolean; symbol: string; leverage: number; substituted: boolean }
  | { prepared: false; reason: string };

/**
 * Prepare a member's deployment end to end: resolve its venue, key, instrument
 * and leverage, then apply the account settings if the fingerprint has moved.
 *
 * Called after activation (so the first order is already warm) and again from the
 * executor, where it costs nothing once prepared. Never throws for an
 * unconfigured deployment — it reports why, because activation must not fail on a
 * warm-up.
 */
export async function prepareDeployment(userId: string, botId: string): Promise<PrepareResult> {
  const deployment = await prisma.userBot.findUnique({
    where: { userId_botId: { userId, botId } },
    select: {
      id: true,
      exchangeSource: true,
      exchangePrepared: true,
      bot: { select: { ticker: true, riskClass: true, config: true, exchanges: true } },
    },
  });
  if (!deployment) return { prepared: false, reason: "deployment not found" };

  const chosen = chosenExchange(deployment.exchangeSource, deployment.bot.exchanges);
  if (!chosen) return { prepared: false, reason: "no execution exchange chosen" };
  if (chosen !== "Bitget") return { prepared: false, reason: `${chosen} is not wired for trading yet` };

  const connection = await getDecryptedConnection(userId, chosen);
  if (!connection) return { prepared: false, reason: `no ${chosen} connection` };

  const profile = profileFor(deployment.bot.config as unknown as BotConfig, deployment.bot.riskClass);
  if (!profile) return { prepared: false, reason: `config has no ${deployment.bot.riskClass} profile` };

  const creds: TradeCreds = {
    apiKey: connection.apiKey,
    apiSecret: connection.apiSecret,
    passphrase: connection.passphrase,
    sandbox: connection.sandbox,
  };
  const { symbol, market, substituted } = await resolveSymbol(chosen, deployment.bot.ticker, creds.sandbox);

  const contacted = await ensurePrepared({
    userBotId: deployment.id,
    exchange: chosen,
    creds,
    symbol,
    market,
    leverage: profile.lev,
    prepared: deployment.exchangePrepared,
  });

  return { prepared: true, contacted, symbol, leverage: profile.lev, substituted };
}
