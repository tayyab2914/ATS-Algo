import "server-only";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Exchange, MarketInterface, Position } from "ccxt";
import { prisma } from "@/lib/db";

/**
 * A ccxt client built for the order path, where every avoided round-trip is a
 * better fill. Measured against Bitget:
 *
 *   import("ccxt")   1462 ms   →  import bitget only        679 ms  (boot only)
 *   loadMarkets()    2703 ms   →  setMarkets([cached])        0 ms  (1950 markets vs 1.3 KB)
 *                               (and 1091 ms when it must load, see loadAllMarkets)
 *
 * Two things are cached in module scope, and on a single long-lived server they
 * stay cached for the life of the process: the exchange constructor and the
 * market descriptors. **Credentials are never cached** — building a client costs
 * only ~8 ms, far cheaper than keeping decrypted API secrets resident in memory
 * between requests.
 *
 * Node runtime only (`serverExternalPackages: ["ccxt"]` in next.config.ts).
 */

export type TradeCreds = {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  /** Bitget's paper engine when true. The one switch between demo and real money. */
  sandbox: boolean;
};

type ExchangeCtor = new (config: Record<string, unknown>) => Exchange;

let ctorPromise: Promise<ExchangeCtor> | null = null;
let importSource: "bitget-only" | "full-ccxt" | null = null;

/** Which import path the cold start actually took. Logged, not branched on. */
export const ccxtImportSource = () => importSource;

/**
 * Force the ccxt import now, so an order doesn't pay for it later. Called once
 * at server boot from instrumentation.ts; the module-scope cache does the rest.
 */
export async function warmCcxt(): Promise<{ importSource: string; ms: number }> {
  const started = Date.now();
  await bitgetCtor();
  return { importSource: importSource ?? "unknown", ms: Date.now() - started };
}

/**
 * Import only Bitget rather than all ~100 ccxt exchanges.
 *
 * ccxt's `exports` map exposes only ".", so `import("ccxt/js/src/bitget.js")` is
 * an ERR_PACKAGE_PATH_NOT_EXPORTED. We resolve the package root and import the
 * file by absolute URL instead, hidden from the bundlers so they leave it as a
 * runtime import. A computed path is invisible to file tracing, so the deep
 * module can be absent if the build is ever pruned — hence the fallback, which
 * is correct, just slower to boot.
 */
async function importBitget(): Promise<ExchangeCtor> {
  try {
    const req = createRequire(path.join(process.cwd(), "index.js"));
    const entry = req.resolve("ccxt").split(path.sep).join("/");
    const marker = "/node_modules/ccxt/";
    const at = entry.lastIndexOf(marker);
    if (at !== -1) {
      const url = pathToFileURL(`${entry.slice(0, at + marker.length)}js/src/bitget.js`).href;
      const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
      const Ctor = (mod.default ?? mod) as ExchangeCtor;
      if (typeof Ctor === "function") {
        importSource = "bitget-only";
        return Ctor;
      }
    }
  } catch {
    // Deep import unavailable (bundled, traced away, or layout changed) — fall back.
  }
  const ccxt = await import("ccxt");
  importSource = "full-ccxt";
  return (ccxt as unknown as Record<string, ExchangeCtor>).bitget;
}

function bitgetCtor(): Promise<ExchangeCtor> {
  // Cache the promise, not the result, so concurrent cold requests share one import.
  ctorPromise ??= importBitget().catch((error) => {
    ctorPromise = null; // a failed import must not poison the instance
    throw error;
  });
  return ctorPromise;
}

// ── Market descriptors ───────────────────────────────────────────────────────
// Process-lifetime memos. `missMemo` matters as much as `marketMemo`: without
// it, a symbol the paper venue doesn't list would re-pay loadMarkets() on every
// trade.

const marketMemo = new Map<string, MarketInterface>();
const missMemo = new Set<string>();
const marketInflight = new Map<string, Promise<MarketInterface | null>>();
const listInflight = new Map<string, Promise<Record<string, MarketInterface>>>();

const memoKey = (exchange: string, symbol: string, sandbox: boolean) => `${exchange}:${sandbox}:${symbol}`;
const listKey = (exchange: string, sandbox: boolean) => `${exchange}:${sandbox}`;

/** ccxt market objects are plain data; a JSON round-trip makes them Prisma-safe. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toJson = (market: MarketInterface): any => JSON.parse(JSON.stringify(market));

/**
 * The ccxt market descriptor for a symbol, or null when the venue does not list
 * it in this mode. Reads the memo, then `market_cache`, and only then pays the
 * ~2.7 s `loadMarkets()`.
 *
 * Concurrent callers for the same symbol share one in-flight resolution: a
 * fan-out opens the same instrument for many users at once, and a cold memo must
 * not run loadMarkets() once per user.
 */
export async function getMarket(exchange: string, symbol: string, sandbox: boolean): Promise<MarketInterface | null> {
  const key = memoKey(exchange, symbol, sandbox);
  const hit = marketMemo.get(key);
  if (hit) return hit;
  if (missMemo.has(key)) return null;

  const pending = marketInflight.get(key);
  if (pending) return pending;

  const resolution = resolveMarket(exchange, symbol, sandbox, key).finally(() => marketInflight.delete(key));
  marketInflight.set(key, resolution);
  return resolution;
}

async function resolveMarket(exchange: string, symbol: string, sandbox: boolean, key: string): Promise<MarketInterface | null> {
  const row = await prisma.marketCache.findUnique({
    where: { exchange_symbol_sandbox: { exchange, symbol, sandbox } },
    select: { data: true },
  });
  if (row) {
    const market = row.data as unknown as MarketInterface;
    marketMemo.set(key, market);
    return market;
  }

  const markets = await loadAllMarkets(exchange, sandbox);
  const market = markets[symbol];
  if (!market) {
    missMemo.add(key); // not listed on this venue in this mode
    return null;
  }

  await cacheMarket(exchange, sandbox, symbol, market);
  marketMemo.set(key, market);
  return market;
}

/**
 * The full market list, straight from the venue. Slow — cold path and cron only,
 * and deduped per (exchange, mode) so a fan-out never loads it more than once.
 *
 * `fetchCurrencies` is switched off: it costs a separate call to a *spot*
 * endpoint that swap trading never reads (precision and limits live on the market
 * itself), and it is one more thing that can fail. Skipping it takes the load from
 * ~2.7 s to ~1.1 s. One retry, because a transient failure here blocks a trade.
 */
function loadAllMarkets(exchange: string, sandbox: boolean): Promise<Record<string, MarketInterface>> {
  const key = listKey(exchange, sandbox);
  const pending = listInflight.get(key);
  if (pending) return pending;

  const load = (async () => {
    if (exchange !== "Bitget") throw new Error(`UNSUPPORTED_EXCHANGE:${exchange}`);
    const Ctor = await bitgetCtor();

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ex = new Ctor({ enableRateLimit: true, timeout: 15_000, options: { defaultType: "swap" } });
      ex.has["fetchCurrencies"] = false;
      ex.setSandboxMode(sandbox);
      try {
        await ex.loadMarkets();
        return ex.markets as unknown as Record<string, MarketInterface>;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  })().finally(() => listInflight.delete(key));

  listInflight.set(key, load);
  return load;
}

async function cacheMarket(exchange: string, sandbox: boolean, symbol: string, market: MarketInterface): Promise<void> {
  const data = toJson(market);
  await prisma.marketCache.upsert({
    where: { exchange_symbol_sandbox: { exchange, symbol, sandbox } },
    create: { exchange, symbol, sandbox, data },
    update: { data },
  });
}

/**
 * Refresh the cache for the symbols a venue actually trades. Cron only, never the
 * order path. Symbols the venue does not list in this mode are skipped, which is
 * what keeps a missing row meaningful. Returns the symbols cached.
 */
export async function refreshMarketCache(exchange: string, sandbox: boolean, symbols: string[]): Promise<string[]> {
  if (symbols.length === 0) return [];
  const markets = await loadAllMarkets(exchange, sandbox);
  const cached: string[] = [];
  for (const symbol of symbols) {
    const market = markets[symbol];
    if (!market) continue;
    await cacheMarket(exchange, sandbox, symbol, market);
    const key = memoKey(exchange, symbol, sandbox);
    marketMemo.set(key, market);
    missMemo.delete(key);
    cached.push(symbol);
  }
  return cached;
}

/**
 * Last traded price, from the venue's public feed — no credentials involved.
 *
 * Used by the admin dispatch panel to size an entry the same way a TradingView
 * alert's bar-close price would, rather than making an admin type one in. Costs a
 * round-trip, which is fine: an admin click is not the order path, and a real
 * `enter` webhook carries its own price so it never comes here.
 *
 * Retried once, because a transient network blip should not turn a deliberate
 * admin action into an error.
 */
export async function publicPrice(exchange: string, symbol: string): Promise<number> {
  const market = await getMarket(exchange, symbol, false);
  if (!market) throw new Error(`NO_MARKET:${symbol}`);
  const ex = await exchangeClient(exchange, { apiKey: "", apiSecret: "", sandbox: false }, [market]);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const price = Number((await ex.fetchTicker(symbol)).last);
      if (Number.isFinite(price) && price > 0) return price;
      lastError = new Error(`NO_PRICE:${symbol}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * A trade-ready client with its markets injected — `loadMarkets()` is never
 * called here, so this costs one constructor (~8 ms) and no network at all.
 *
 * `enableRateLimit` stays on: the throttle is empty on a fresh client, so the
 * entry order pays nothing and only a following call can wait ~50 ms — and that
 * lands on the resting take-profit batch, which is not latency-sensitive.
 */
export async function exchangeClient(exchange: string, creds: TradeCreds, markets: MarketInterface[]): Promise<Exchange> {
  if (exchange !== "Bitget") throw new Error(`UNSUPPORTED_EXCHANGE:${exchange}`);
  const Ctor = await bitgetCtor();
  const ex = new Ctor({
    apiKey: creds.apiKey,
    secret: creds.apiSecret,
    password: creds.passphrase, // ccxt calls Bitget's passphrase "password"
    enableRateLimit: true,
    timeout: 10_000,
    options: { defaultType: "swap" },
  });
  ex.setSandboxMode(creds.sandbox);
  ex.setMarkets(markets);
  return ex;
}

/**
 * The venue's position for exactly `symbol`, or null when there is none.
 *
 * Match on `info.symbol` — the raw venue id — and NEVER on the unified
 * `position.symbol`, which is actively wrong here. Bitget's all-position read
 * returns every position for the productType regardless of the symbol asked for,
 * and a client built above knows exactly one market, because `loadMarkets()` is
 * deliberately never called. ccxt resolves each unknown market id against the
 * market it was filtered on, so a member's unrelated `CROUSDT` position comes
 * back *relabelled* `BTC/USDT:USDT` with CRO's contract count. It then passes
 * ccxt's own symbol filter, lands at `positions[0]`, and looks exactly like ours.
 *
 * Every caller that trusted `[0]` therefore acted on someone else's trade: the
 * flatten path tried to market-close 197966 foreign contracts against this
 * symbol (Bitget 22002, "No position to close") and, because a reversal must
 * close before it opens, blocked every entry queued behind it; settle read
 * "still open" forever and never booked PnL; the ratchet sized a stop off the
 * wrong position; and the orphan scan reported the member's own manual trade as
 * an untracked one of ours.
 *
 * Falling back to the unified symbol when the venue sends no raw id keeps this
 * from calling an account flat — which would settle a live position — on a
 * response shape that has no id to compare.
 */
export async function livePosition(ex: Exchange, symbol: string): Promise<Position | null> {
  const marketId = ex.markets?.[symbol]?.id;
  const positions = await ex.fetchPositions([symbol]);
  return (
    positions.find((position) => {
      const venueId = (position.info as { symbol?: string } | null | undefined)?.symbol;
      if (venueId !== undefined && marketId !== undefined) return venueId === marketId;
      return position.symbol === symbol;
    }) ?? null
  );
}
