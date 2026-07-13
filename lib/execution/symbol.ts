import "server-only";
import type { MarketInterface } from "ccxt";
import { getMarket } from "./client";

/**
 * Turning a bot's ticker into a venue symbol, using only cached market
 * descriptors — `loadMarkets()` never runs on the order path.
 */

/**
 * Bitget's paper venue lists ~51 perps against ~1950 live, so a bot whose
 * instrument isn't there can't be exercised on demo at all. We substitute this
 * one, and **only in sandbox** — live never trades an instrument the bot didn't
 * ask for.
 */
export const DEMO_FALLBACK_SYMBOL = "BTC/USDT:USDT";

/**
 * `"BTC"`, `"BTCUSDT"`, `"BTCUSDT.P"`, `"BTCPERP"` → `"BTC/USDT:USDT"`.
 *
 * Suffixes are stripped in order rather than by a single alternation: `String.replace`
 * removes only the first match, so `/USDT$|\.P$/` would turn `"BTCUSDT.P"` into
 * `"BTCUSDT"` and then build the nonexistent `BTCUSDT/USDT:USDT`.
 */
export function toSwapSymbol(ticker: string | null | undefined): string | null {
  const raw = (ticker ?? "").trim().toUpperCase();
  if (!raw) return null;
  let base = raw;
  for (const suffix of [/\.P$/, /PERP$/, /USDT$/, /USD$/]) base = base.replace(suffix, "");
  if (!base) base = raw; // a ticker that was nothing but a suffix
  return `${base}/USDT:USDT`;
}

export type ResolvedSymbol = {
  symbol: string;
  market: MarketInterface;
  /** What the bot's ticker actually asked for, before any demo substitution. */
  requested: string;
  substituted: boolean;
};

/**
 * Resolve a bot's ticker to a tradable swap market. Throws `NO_TICKER` when the
 * bot has none and `NO_MARKET:<symbol>` when the venue doesn't list it — except
 * in sandbox, where {@link DEMO_FALLBACK_SYMBOL} stands in so the pipeline can
 * still be exercised.
 */
export async function resolveSymbol(exchange: string, ticker: string | null, sandbox: boolean): Promise<ResolvedSymbol> {
  const wanted = toSwapSymbol(ticker);
  if (!wanted) throw new Error("NO_TICKER");

  const market = await getMarket(exchange, wanted, sandbox);
  if (market?.swap) return { symbol: wanted, market, requested: wanted, substituted: false };

  if (sandbox) {
    const fallback = await getMarket(exchange, DEMO_FALLBACK_SYMBOL, true);
    if (fallback?.swap) {
      return { symbol: DEMO_FALLBACK_SYMBOL, market: fallback, requested: wanted, substituted: true };
    }
  }

  throw new Error(`NO_MARKET:${wanted}`);
}
