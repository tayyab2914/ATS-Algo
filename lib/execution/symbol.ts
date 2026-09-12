import "server-only";
import type { MarketInterface } from "ccxt";
import { demoFallbackFor, getMarket, getMarketByVenueId } from "./client";

/**
 * Turning a bot's ticker into a venue symbol, using only cached market
 * descriptors — `loadMarkets()` never runs on the order path.
 */

/**
 * Bitget's paper venue lists ~51 perps against ~1950 live, so a bot whose instrument isn't
 * there can't be exercised on demo at all. We substitute a stand-in, and **only in sandbox** —
 * live never trades an instrument the bot didn't ask for.
 *
 * PER-VENUE, and deliberately absent for some: Bybit's demo lists the full set (proven on the
 * venue — 679 demo against 679 live, zero missing), so it substitutes NOTHING and paper trades
 * run the bot's real instrument. The stand-in is a workaround for a thin paper venue, not a
 * feature; a venue that doesn't need it must not get it.
 *
 * @see demoFallbackFor in ./client — the per-venue source of truth.
 */
export const DEMO_FALLBACK_SYMBOL = "BTC/USDT:USDT";

/**
 * `"BTC"`, `"BTCUSDT"`, `"BTCUSDT.P"`, `"BTCPERP"` → `"BTC/USDT:USDT"`.
 *
 * Suffixes are stripped in order rather than by a single alternation: `String.replace`
 * removes only the first match, so `/USDT$|\.P$/` would turn `"BTCUSDT.P"` into
 * `"BTCUSDT"` and then build the nonexistent `BTCUSDT/USDT:USDT`.
 *
 * A value that is ALREADY a ccxt symbol (it contains a `/`) is passed through
 * untouched. That is the escape hatch for an instrument this convention cannot
 * describe — the derivation assumes a USDT-margined perpetual, which is every
 * crypto pair and none of the commodity or metals contracts.
 */
export function toSwapSymbol(ticker: string | null | undefined): string | null {
  const raw = (ticker ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw.includes("/")) return raw;
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
 * Resolve a bot's ticker to a tradable swap market. Throws `NO_TICKER` when the bot has none
 * and `NO_MARKET:<symbol>` when the venue doesn't list it — except in sandbox on a venue whose
 * paper engine is thin, where its stand-in symbol takes over so the pipeline can still be
 * exercised. A venue whose demo lists everything never substitutes, and raises `NO_MARKET`
 * exactly as live would.
 *
 * `ticker` is what THIS venue should be asked for — the bot's per-venue override where it has
 * one, else its plain ticker (see `tickerFor` in lib/ticker-map.ts). Three shapes are accepted,
 * tried in this order:
 *
 *   "BTC" / "BTCUSDT.P"  the crypto convention, derived into BTC/USDT:USDT
 *   "NCCO1OILWTI2USD"    the venue's OWN instrument name, matched against market.id
 *   "BTC/USDT:USDT"      a ccxt symbol, used verbatim
 *
 * The derived symbol is tried FIRST and the id lookup only on its miss, so nothing about how a
 * crypto bot resolves changes — and the id lookup, which costs a `loadMarkets()` on a cold
 * miss, is never reached by a bot whose instrument the convention already describes.
 */
export async function resolveSymbol(exchange: string, ticker: string | null, sandbox: boolean): Promise<ResolvedSymbol> {
  const raw = (ticker ?? "").trim();
  const wanted = toSwapSymbol(raw);
  if (!wanted) throw new Error("NO_TICKER");

  const market = await getMarket(exchange, wanted, sandbox);
  if (market?.swap) return { symbol: wanted, market, requested: wanted, substituted: false };

  // Not a symbol this venue lists — so ask whether it is the venue's own name for an
  // instrument. This is the path every commodities and metals bot takes, because no
  // derivation turns "WTI oil" into all four of the venues' names for it.
  if (!raw.includes("/")) {
    const byId = await getMarketByVenueId(exchange, raw, sandbox);
    if (byId?.swap) return { symbol: byId.symbol, market: byId, requested: byId.symbol, substituted: false };
  }

  const fallbackSymbol = sandbox ? demoFallbackFor(exchange) : null;
  if (fallbackSymbol) {
    const fallback = await getMarket(exchange, fallbackSymbol, true);
    if (fallback?.swap) {
      return { symbol: fallbackSymbol, market: fallback, requested: wanted, substituted: true };
    }
  }

  throw new Error(`NO_MARKET:${wanted}`);
}
