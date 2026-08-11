import "server-only";
import type { MarketInterface } from "ccxt";
import { profileFor, type BotConfig } from "@/lib/bot-config";
import { chosenExchange, exchangeEnabled } from "@/lib/bot-exchanges";
import { prisma } from "@/lib/db";
import { getDecryptedConnection } from "@/lib/exchanges/connection";
import { adapterFor, exchangeClient, type TradeCreds } from "./client";
import { resolveSymbol } from "./symbol";

/**
 * Account settings a position depends on — one-way position mode, ISOLATED margin,
 * and the profile's leverage — applied once and remembered, instead of on every
 * order.
 *
 * Each is a REST round-trip. Doing them per trade added three of them ahead of
 * the entry, which is exactly the latency that turns a 0.30% take-profit target
 * into a worse fill. `ensurePrepared` costs nothing once the fingerprint matches.
 */

/**
 * ISOLATED margin, always. The rule is absolute: a loss on one position must never
 * reach the collateral behind another. Cross is never used, and this constant is
 * the ONLY place the mode is chosen — one global value is what makes "never cross"
 * unviolatable, rather than a per-bot setting someone can get wrong.
 *
 * ccxt's Bitget adapter compares `marginMode === "cross"` exactly, sending
 * `crossed` for that and `isolated` for ANYTHING else. So "isolated" is isolated —
 * and, usefully, a typo also lands on isolated rather than silently opening
 * positions on cross. The failure mode points the safe way.
 *
 * This value is part of {@link preparedKey}, so changing it re-prepares every
 * account. Bitget rejects a margin-mode change under an open position (45117), so
 * a cutover must run against a flat book.
 *
 * WHAT DIFFERS PER VENUE is not the value but who applies it — see
 * `VenueAdapter.marginModePolicy`. Where the setting is per-symbol we set it; where it is
 * ACCOUNT-WIDE (Bybit UTA) we only CHECK it and refuse to trade otherwise, because changing it
 * would reconfigure margin across positions that are none of our business. Either way a bot
 * never trades on cross — which is the invariant this constant exists to guarantee.
 */
export const MARGIN_MODE = "isolated";

/**
 * The settings a prepared account is carrying. Compared, not parsed — any change
 * to venue, sandbox mode, instrument, leverage **or margin mode** yields a
 * different string and re-prepares.
 *
 * The margin mode is in here because leaving it out is a silent, expensive bug:
 * the `demo|live` segment is the SANDBOX mode, not the margin mode. Without the
 * margin mode present, changing {@link MARGIN_MODE} would leave every stored
 * fingerprint still matching — `ensurePrepared` short-circuits, `setMarginMode` is
 * never re-sent, and every account keeps trading on the OLD mode while each order
 * claims the new one.
 */
export const preparedKey = (
  exchange: string,
  sandbox: boolean,
  symbol: string,
  leverage: number,
  marginMode: string = MARGIN_MODE,
): string => `${exchange}|${sandbox ? "demo" : "live"}|${symbol}|${leverage}|${marginMode}`;

/**
 * Venue answers that mean "already in the state you asked for".
 *
 * Deliberately a narrow allow-list of codes and their exact messages, never a broad match on
 * words like "margin" or "leverage" — those appear in genuine failures too (Bitget 45117
 * "currently holding positions", insufficient-margin rejections), and swallowing one of those
 * would let a trade proceed on settings that were never applied.
 *
 *   110025  Bybit  position mode is not modified
 *   110026  Bybit  margin mode is already set  (ccxt: MarginModeAlreadySet)
 *   110043  Bybit  leverage not modified       (ccxt maps this to BadRequest, not NoChange)
 *   30084   Bybit  isolated not modified
 *   34036   Bybit  leverage not modified (legacy)
 */
const NO_CHANGE = /\b(110025|110026|110043|30084|34036)\b|not modified|already set|no need to (modify|change)/i;

/** Await a prep call, tolerating only "already at that value". Anything else propagates. */
async function noChangeOk(call: Promise<unknown>): Promise<void> {
  try {
    await call;
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (!NO_CHANGE.test(raw)) throw error;
  }
}

/**
 * Refuse to trade unless the member's account is ALREADY on isolated margin.
 *
 * For venues where the setting is account-wide, so changing it for them would silently
 * reconfigure margin across their whole account. The bot declining to start is the lesser
 * harm — and it is recoverable by the member in one click, whereas a surprise margin change
 * under an unrelated open position is not.
 *
 * FAILS CLOSED on live: an unreadable mode is treated as a refusal, not as permission. The
 * whole point is that a bot must never trade on cross, and "we could not check" is not
 * evidence that it isn't.
 *
 * The one exception is the PAPER engine, where the endpoint genuinely does not exist (Bybit's
 * demo has no /v5/account/info) and there is no real collateral to protect. Skipping the check
 * there is what keeps the demo suites runnable.
 */
async function assertMarginMode(
  ex: Awaited<ReturnType<typeof exchangeClient>>,
  adapter: ReturnType<typeof adapterFor>,
  input: PrepareInput,
): Promise<void> {
  const mode = adapter.readMarginMode ? await adapter.readMarginMode(ex, input.symbol).catch(() => null) : null;

  if (mode === null) {
    if (input.creds.sandbox) return; // paper: unknowable, and nothing at stake
    throw new Error("MARGIN_MODE_UNKNOWN");
  }
  if (mode !== MARGIN_MODE) throw new Error(`MARGIN_MODE_NOT_ISOLATED:${mode}`);
}

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

  // ── Margin mode ───────────────────────────────────────────────────────────
  // ISOLATED always, but HOW we get there depends on the venue's blast radius.
  //
  //   "set"   — per-symbol (Bitget). Applying it touches only this bot's instrument, so we do
  //             it for the member.
  //   "check" — ACCOUNT-WIDE (Bybit UTA: the call carries no symbol). Setting it would
  //             reconfigure margin for every position the member holds, including trades we
  //             have nothing to do with. We refuse to reach that far into someone's account:
  //             we READ the mode and decline to trade if it is not isolated. The member changes
  //             it themselves, deliberately, or their bot does not start.
  const adapter = adapterFor(input.exchange);
  if (adapter.marginModePolicy === "set") {
    await noChangeOk(ex.setMarginMode(MARGIN_MODE, input.symbol));
  } else {
    await assertMarginMode(ex, adapter, input);
  }

  // Leverage is per-symbol everywhere we support, so it is always set.
  //
  // Repeating it with the SAME value is not uniformly a no-op: Bybit answers "not modified"
  // with an ERROR (110043) rather than success, so an idempotent prep pass — which is exactly
  // what this is, since the fingerprint can miss — would throw on a correctly-configured
  // account and block the trade. Bitget accepts a repeat silently.
  //
  // So swallow ONLY "already at the requested value". That is safe on any venue by definition:
  // the error states the account is in the state we asked for. Every other failure still
  // propagates, which is essential — Bitget's 45117 (and Bybit's own guards) mean leverage was
  // changed under an open position, and that must NOT be silently ignored.
  // `leverageParams` is not decoration: on BloFin, omitting `marginMode` makes ccxt default to
  // CROSS and set the leverage on the wrong book, silently, while the account trades isolated.
  await noChangeOk(ex.setLeverage(input.leverage, input.symbol, adapter.leverageParams(MARGIN_MODE)));

  await prisma.userBot.update({ where: { id: input.userBotId }, data: { exchangePrepared: key } });
  return true;
}

/**
 * Forget the fingerprint so the next order re-applies the settings. Only needed
 * when something outside the fingerprint changes (e.g. the API key is replaced);
 * venue, sandbox mode, symbol, leverage and margin mode all invalidate themselves.
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
  if (!exchangeEnabled(chosen)) return { prepared: false, reason: `${chosen} is not wired for trading yet` };

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
