import { matchBotExchange } from "@/lib/bot-exchanges";

/**
 * What each venue calls one bot's instrument.
 *
 * A bot carries ONE `ticker`, which works only as long as the venues agree on the
 * name — and they agree on crypto and nothing else. "BTC" resolves on all four;
 * WTI oil is NCCO1OILWTI2USD on BingX, AXTI on Bybit and Bitget, and WTIOIL on
 * BloFin, and no single string can be turned into all of those. So a bot may
 * carry a per-venue override, and `ticker` stays the default for every venue that
 * doesn't need one.
 *
 * Kept out of `lib/execution/` deliberately: the admin editor (a client
 * component) and the executor (server-only) must read the same map the same way,
 * and nothing in `lib/execution/` can be imported into the browser.
 */
export type TickerMap = Record<string, string>;

/**
 * Characters a venue instrument name may contain — enough for every shape the
 * four venues use, and for a ccxt symbol typed in directly:
 *
 *   NCCO1OILWTI2USD   BTC-USDT   BTC/USDT:USDT   XAU_USD   1000PEPEUSDT
 *
 * Deliberately excludes whitespace: a name with a space in it is a typo or a
 * pasted label, never an instrument, and it would resolve to NO_MARKET at the
 * worst possible moment — when a signal fires.
 */
const TICKER_PATTERN = /^[A-Za-z0-9/:_.-]+$/;

export const TICKER_MAX_LENGTH = 40;

/**
 * Read the `tickerMap` JSON column. Tolerant by necessity — it is `Json?`, so the
 * database can hand back null, a scalar, or an array, and the executor must not
 * throw on the order path over a malformed one. Anything unusable reads as "no
 * overrides", which falls the bot back to its plain `ticker`.
 */
export function parseTickerMap(value: unknown): TickerMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: TickerMap = {};
  for (const [venue, name] of Object.entries(value as Record<string, unknown>)) {
    if (typeof name !== "string") continue;
    const trimmed = name.trim();
    if (trimmed) out[venue] = trimmed;
  }
  return out;
}

/**
 * The instrument name to trade for a bot on one venue: its override if it has
 * one, else its plain ticker.
 *
 * Every symbol resolution on the order path goes through here, so a bot with no
 * overrides behaves exactly as it did before the map existed.
 */
export function tickerFor(
  bot: { ticker: string | null; tickerMap?: unknown },
  exchange: string | null | undefined,
): string | null {
  if (!exchange) return bot.ticker;
  const map = parseTickerMap(bot.tickerMap);
  // Keys are canonical venue names, but match case-insensitively anyway: the
  // column is free-form JSON and a hand-edited row must not silently stop
  // overriding.
  const hit = Object.entries(map).find(([venue]) => venue.toLowerCase() === exchange.toLowerCase());
  return hit?.[1] ?? bot.ticker;
}

/**
 * Normalise a map on the way IN — from the admin editor or an API caller.
 *
 * Keys are resolved to canonical venue names and anything outside `allowed` is
 * dropped, so narrowing a bot's exchanges can't leave an override behind for a
 * venue the bot no longer runs on. Blank values are dropped rather than stored:
 * "no override" and "an empty override" must not be two different states.
 */
export function normalizeTickerMap(input: unknown, allowed: string[]): TickerMap {
  const parsed = parseTickerMap(input);
  const permitted = new Set(allowed.map((e) => matchBotExchange(e)).filter(Boolean));
  const out: TickerMap = {};
  for (const [venue, name] of Object.entries(parsed)) {
    const canonical = matchBotExchange(venue);
    if (!canonical || !permitted.has(canonical)) continue;
    out[canonical] = name.toUpperCase();
  }
  return out;
}

/**
 * Why a map is unacceptable, or null when it is fine. Written for an admin,
 * because this is the field that decides whether a live signal finds its
 * instrument.
 */
export function tickerMapError(input: unknown): string | null {
  const parsed = parseTickerMap(input);
  for (const [venue, name] of Object.entries(parsed)) {
    if (name.length > TICKER_MAX_LENGTH) {
      return `The ${venue} ticker is too long (max ${TICKER_MAX_LENGTH} characters).`;
    }
    if (!TICKER_PATTERN.test(name)) {
      return `“${name}” isn't a valid ${venue} ticker — use the name the venue itself shows, with no spaces.`;
    }
  }
  return null;
}

/** Whether two maps hold the same overrides — for the editor's dirty check. */
export function sameTickerMap(a: TickerMap, b: TickerMap): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((k) => a[k] === b[k]);
}

/** `Bybit → AXTI, Bingx → NCCO1OILWTI2USD`, for change notes and logs. */
export function describeTickerMap(map: TickerMap): string {
  const entries = Object.entries(map);
  if (entries.length === 0) return "none";
  return entries.map(([venue, name]) => `${venue} → ${name}`).join(", ");
}
