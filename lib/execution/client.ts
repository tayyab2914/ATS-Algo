import "server-only";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Exchange, MarketInterface, Position } from "ccxt";
import { BOT_EXCHANGES } from "@/lib/bot-exchanges";
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
  /** Bitget and Blofin require one; Bybit has no such field. */
  passphrase?: string;
  /** The venue's paper engine when true. The one switch between demo and real money. */
  sandbox: boolean;
};

type ExchangeCtor = new (config: Record<string, unknown>) => Exchange;

/** Bybit reaches its demo engine through this, not through `setSandboxMode`. */
type DemoTradingExchange = Exchange & { enableDemoTrading(enable: boolean): void };

/** ccxt implicit method for GET /v5/account/info — the only place Bybit's margin mode lives. */
type AccountInfoExchange = Exchange & {
  privateGetV5AccountInfo(params: Record<string, unknown>): Promise<unknown>;
};

/** Bybit's account-level margin modes, mapped to the vocabulary the engine speaks. */
const BYBIT_MARGIN_MODES: Record<string, string> = {
  ISOLATED_MARGIN: "isolated",
  REGULAR_MARGIN: "cross",
  PORTFOLIO_MARGIN: "portfolio",
};

/** The parts of an order the entry path needs: what actually filled, and at what price. */
export type FillRead = {
  average?: number;
  filled?: number;
  price?: number;
  status?: string;
  /**
   * The client id the venue has against this order.
   *
   * Carried because stop-out ATTRIBUTION needs it, not for completeness. When a stop fires, some
   * venues execute it via a separate order and the only link back to the stop we recorded is this
   * field (Bitget: the child's clientOid IS the plan-order id). manage.ts resolves that link, and
   * on a venue with no `fetchOrder` there is no other way to reach it.
   */
  clientOrderId?: string;
};

type RawishOrder = {
  average?: unknown; filled?: unknown; price?: unknown; status?: unknown;
  clientOrderId?: unknown; info?: unknown;
};

const asFill = (order: RawishOrder | undefined | null): FillRead | null => {
  if (!order) return null;
  const num = (v: unknown) => (v === undefined || v === null ? undefined : Number(v));
  // Fall back to the raw payload: the venues disagree on the field name, and ccxt only unifies
  // some of them (Bitget calls it clientOid, BloFin and Bybit clientOrderId / orderLinkId).
  const raw = (order.info ?? {}) as { clientOid?: string; clientOrderId?: string; orderLinkId?: string };
  const cid = order.clientOrderId ?? raw.clientOrderId ?? raw.clientOid ?? raw.orderLinkId;
  return {
    average: num(order.average),
    filled: num(order.filled),
    price: num(order.price),
    status: order.status === undefined || order.status === null ? undefined : String(order.status),
    clientOrderId: cid === undefined || cid === null || cid === "" ? undefined : String(cid),
  };
};

/** `fetchOrder` where the venue has it. */
const fillViaFetchOrder = (params: Record<string, unknown>) =>
  async (ex: Exchange, symbol: string, orderId: string): Promise<FillRead | null> =>
    asFill(await ex.fetchOrder(orderId, symbol, params).catch(() => null));

/**
 * Per-venue ccxt facts the order path needs.
 *
 * An entry here is the CAPABILITY: the engine can construct a client and load markets.
 * `BotExchange.wired` in lib/bot-exchanges.ts is the RELEASE GATE, and the two are not the
 * same thing:
 *
 *   adapter, `wired: false`  — the normal in-progress state. Build the adapter, prove the
 *                              venue with the probe scripts, THEN flip the gate.
 *   `wired: true`, no adapter — a bug. Every gate passes and then each signal throws
 *                              UNSUPPORTED_EXCHANGE. Warned about below.
 */
type VenueAdapter = {
  /** ccxt constructor id — also the deep-import filename, `js/src/<ccxtId>.js`. */
  ccxtId: string;
  /**
   * Constructor options. Bybit needs `defaultSubType` because every private call carries a
   * `category` derived from it; Bitget instead derives a `productType` from the market.
   */
  options: Record<string, unknown>;
  /**
   * Put the client on the venue's PAPER engine. A function per venue, because the venues do
   * genuinely different things and getting it wrong is silent:
   *
   *   Bitget — `setSandboxMode` swaps NO url. It injects a `PAPTRADING: 1` header on the live
   *            host, so the SAME key works in both modes.
   *   Bybit  — swaps HOST, and there are TWO paper hosts. `setSandboxMode` goes to
   *            api-testnet, a SEPARATE exchange with its own registration and its own keys;
   *            the demo engine is api-demo, reachable ONLY via `enableDemoTrading`. Sending a
   *            demo key to testnet fails auth and looks exactly like a bad key.
   *
   * Safe to call with `false`: both are no-ops on a fresh client.
   */
  paperMode: (ex: Exchange, on: boolean) => void;
  /**
   * A stand-in symbol for when the venue's PAPER engine does not list the bot's instrument.
   *
   * Bitget's demo lists ~51 perps against ~1950 live, so without a substitute a bot simply
   * cannot be exercised on paper. Bybit's demo lists the FULL set — proven on the venue, 679
   * demo against 679 live with zero missing — so it has none, and must never substitute:
   * paper trades run the bot's real instrument there, which is strictly better testing.
   */
  demoFallbackSymbol?: string;
  /**
   * Whether this venue rejects a request whose timestamp differs from its server clock.
   *
   * Bybit does, and asymmetrically: it tolerates being BEHIND by `recvWindow` but only ~1s
   * AHEAD, so widening the window does not help a fast clock. A 1.2s local skew made every
   * signed Bybit call fail with `10002` → ccxt `InvalidNonce` while Bitget was unaffected.
   * Compensated by injecting `options.timeDifference`, which the adapter subtracts in
   * `nonce()`. Bitget signs happily without it, so it is left alone.
   */
  syncClock?: boolean;
  /**
   * Extra params every order on this venue carries, beyond the unified ones.
   *
   * `clientOrderId` is NOT here because it is genuinely universal — bitget.js:5220 reads
   * `clientOid` OR `clientOrderId` and normalises to its own, and bybit maps it to
   * `orderLinkId`. Passing the unified name is correct on both, and passing Bitget's
   * `clientOid` to Bybit would leak it into the body as a junk field.
   *
   * What IS venue-specific: `oneWayMode` is a Bitget swap/future param, and `marginMode` is
   * read per order there. Bybit needs neither — `category` comes from `defaultSubType`, and
   * `positionIdx` defaults to 0 in one-way mode (bybit.js:4194), so injecting it is wrong.
   */
  orderParams(marginMode: string): Record<string, unknown>;
  /**
   * Extra params `setLeverage` needs on this venue.
   *
   * BloFin is why this exists and it is a MONEY bug, not a tidiness one: its ccxt adapter runs
   * `handleMarginModeAndParams('setLeverage', params, 'cross')`, so calling `setLeverage(lev,
   * symbol)` with no params sets the leverage for the venue's CROSS book while the account trades
   * ISOLATED. Silent, and wrong in the direction that matters.
   *
   * Empty for Bitget and Bybit, deliberately: both derive the margin context from the market or
   * the account, and an unexpected `marginMode` field would just leak into their request bodies.
   */
  leverageParams(marginMode: string): Record<string, unknown>;
  /**
   * Maximum legs in ONE `createOrders` call. A longer take-profit ladder must be chunked, and
   * silently over-sending is not an option. Both values measured on the venue, not guessed:
   * Bitget 50, Bybit 10.
   */
  batchMax: number;
  /**
   * Params every `fetchOrder` on this venue needs.
   *
   * Bybit REFUSES the call outright without `acknowledged: true` — `ArgumentsRequired`, before
   * any network round-trip, warning that fetchOrder only reaches the last 500 orders. For an
   * order we placed seconds ago that caveat is irrelevant, but the throw is not optional. This
   * fires on the entry path (`openPosition` reads the true fill, since createOrder returns only
   * an id), so without it Bybit cannot open a position at all.
   */
  fetchOrderParams: Record<string, unknown>;
  /**
   * Read a just-placed order's TRUE fill.
   *
   * A seam rather than a direct `fetchOrder` call, because `createOrder` returns only an id on
   * every venue we support — so this always runs, on the entry path, and one venue cannot do it
   * the usual way. BloFin has NO `fetchOrder` at all (`has.fetchOrder` is undefined; the call
   * throws `NotSupported`), so it reads the fill out of `fetchClosedOrders` instead. Verified on
   * the demo venue that both agree with `fetchMyTrades` and with the position's own entry price.
   *
   * Returns null when the fill cannot be read — callers fall back to what they asked for rather
   * than inventing a number.
   */
  readFill(ex: Exchange, symbol: string, orderId: string): Promise<FillRead | null>;
  /**
   * How ISOLATED margin is achieved on this venue — and whether we may set it at all.
   *
   * `"set"`   — the mode is per-symbol, so applying it touches only the instrument this bot
   *             trades. Safe to set on the member's behalf, and Bitget works this way.
   * `"check"` — the mode is ACCOUNT-WIDE. Setting it would silently reconfigure margin for
   *             every position the member holds, including trades they placed by hand and
   *             instruments we have nothing to do with. We refuse to do that: we READ the
   *             account's mode and decline to trade if it is not isolated, leaving the member
   *             to change it deliberately. Bybit UTA works this way.
   *
   * This is a product decision, not a technical one — the venue would accept the write.
   */
  marginModePolicy: "set" | "check";
  /**
   * Read the account's effective margin mode, for a `"check"` venue. Returns the venue's own
   * string (lowercased) or null when it cannot be determined — never a guess, because a wrong
   * "isolated" here would let a bot trade on cross.
   */
  readMarginMode?(ex: Exchange, symbol: string): Promise<string | null>;
};

const ADAPTERS: Record<string, VenueAdapter> = {
  Bitget: {
    ccxtId: "bitget",
    options: { defaultType: "swap" },
    paperMode: (ex, on) => ex.setSandboxMode(on),
    demoFallbackSymbol: "BTC/USDT:USDT",
    orderParams: (marginMode) => ({ marginMode, oneWayMode: true }),
    leverageParams: () => ({}),
    batchMax: 50,
    fetchOrderParams: {},
    readFill: fillViaFetchOrder({}),
    // Per-symbol on Bitget, so applying it touches only this bot's instrument.
    marginModePolicy: "set",
  },
  Bybit: {
    ccxtId: "bybit",
    // `recvWindow` buys tolerance for a SLOW clock; `syncClock` is what handles a fast one.
    options: { defaultType: "swap", defaultSubType: "linear", recvWindow: 10_000 },
    paperMode: (ex, on) => (ex as DemoTradingExchange).enableDemoTrading(on),
    syncClock: true,
    orderParams: () => ({}),
    leverageParams: () => ({}),
    batchMax: 10,
    fetchOrderParams: { acknowledged: true },
    readFill: fillViaFetchOrder({ acknowledged: true }),
    // ACCOUNT-WIDE on Bybit UTA: `setMarginMode` sends no symbol and reconfigures margin for
    // every position the member holds. We refuse to do that on their behalf — check and decline.
    marginModePolicy: "check",
    async readMarginMode(ex) {
      // The demo engine has no /v5/account/info at all — ccxt says so itself at bybit.js:1442
      // ("info endpoint is not available in demo trading"). Unknowable there, and there is no
      // real account to protect, so null lets the caller allow paper trading.
      if (ex.options["enableDemoTrading"]) return null;
      const response = (await (ex as AccountInfoExchange).privateGetV5AccountInfo({})) as
        | { result?: { marginMode?: string } }
        | undefined;
      const raw = response?.result?.marginMode;
      if (!raw) return null;
      return BYBIT_MARGIN_MODES[raw] ?? raw.toLowerCase();
    },
  },
  Blofin: {
    ccxtId: "blofin",
    options: { defaultType: "swap" },
    // A pure URL swap to demo-trading-openapi — no header (Bitget) and no third host (Bybit).
    paperMode: (ex, on) => ex.setSandboxMode(on),
    // Demo lists 84 USDT perps against 498 live, so a bot's instrument may well be absent.
    demoFallbackSymbol: "BTC/USDT:USDT",
    // `marginMode` is read per order. It is NOT optional here for a different reason than
    // Bitget: see the setLeverage note in prepare.ts — omitting it defaults to CROSS.
    orderParams: (marginMode) => ({ marginMode }),
    // MANDATORY here — see leverageParams on the type. Omit it and the CROSS leverage is set.
    leverageParams: (marginMode) => ({ marginMode }),
    batchMax: 10,
    // Moot: `fetchOrder` does not exist on this adapter at all (has.fetchOrder is undefined),
    // so nothing reads these. Kept so the shape is uniform rather than optional.
    fetchOrderParams: {},
    // No `fetchOrder` on this adapter at all, so the fill comes from the closed-order list. The
    // window is generous because a market entry is read back within seconds of placing it.
    async readFill(ex, symbol, orderId) {
      const closed = await ex.fetchClosedOrders(symbol, Date.now() - 5 * 60_000, 50).catch(() => []);
      return asFill(closed.find((order) => order.id === orderId));
    },
    // ACCOUNT-GLOBAL, proven on the wire: `account/set-margin-mode` carries only
    // {marginMode} — ccxt resolves the symbol and then discards it. BloFin's own UI says the
    // same of position mode: "This setting applies to all contracts".
    marginModePolicy: "check",
    async readMarginMode(ex, symbol) {
      // Unlike Bybit this needs no raw implicit call — has.fetchMarginMode is true and the
      // unified method works on the demo host too.
      const read = await ex.fetchMarginMode(symbol);
      const mode = read?.marginMode ?? (read?.info as { marginMode?: string } | undefined)?.marginMode;
      return mode ? String(mode).toLowerCase() : null;
    },
  },
};

// ── Clock skew ───────────────────────────────────────────────────────────────
// Memoised per venue, because measuring it costs a round-trip and the entry order must never
// pay one. Refreshed on a TTL: clocks drift slowly, so a stale-but-recent offset is far better
// than a fresh measurement taken in front of a market fill. Preloaded by warmCcxt at boot, so
// in practice the order path always reads a warm value.

const CLOCK_TTL_MS = 10 * 60_000;
const clockSkew = new Map<string, { diffMs: number; at: number }>();
const clockInflight = new Map<string, Promise<number>>();

/**
 * Local clock minus the venue's server clock, in ms. Positive means we are AHEAD, which is the
 * direction Bybit refuses. Returns 0 when the venue does not need it or the probe fails —
 * never throws, because a failed measurement must not block a trade that might still succeed.
 */
async function clockSkewFor(exchange: string): Promise<number> {
  const adapter = adapterFor(exchange);
  if (!adapter.syncClock) return 0;

  const hit = clockSkew.get(adapter.ccxtId);
  if (hit && Date.now() - hit.at < CLOCK_TTL_MS) return hit.diffMs;

  const pending = clockInflight.get(adapter.ccxtId);
  if (pending) return pending;

  const load = (async () => {
    try {
      const Ctor = await venueCtor(exchange);
      // Public `fetchTime` only — no credentials, and never on the paper host: the demo engine
      // shares the venue's clock, and a public read is a public read.
      const probe = new Ctor({ enableRateLimit: true, timeout: 10_000, options: { ...adapter.options } });
      const diffMs = await probe.loadTimeDifference();
      clockSkew.set(adapter.ccxtId, { diffMs, at: Date.now() });
      return diffMs;
    } catch {
      return clockSkew.get(adapter.ccxtId)?.diffMs ?? 0; // keep the last good value if any
    } finally {
      clockInflight.delete(adapter.ccxtId);
    }
  })();

  clockInflight.set(adapter.ccxtId, load);
  return load;
}

/** The measured skew per venue, for logging. Null until something has measured it. */
export const clockSkewSnapshot = (): Record<string, number> =>
  Object.fromEntries([...clockSkew].map(([id, { diffMs }]) => [id, diffMs]));

/**
 * The offset to put in `options.timeDifference`, for a caller that builds its OWN client rather
 * than going through {@link exchangeClient} — currently only key validation, which must use the
 * full ccxt module.
 *
 * Exported because omitting it is a silent, badly-misleading failure: an unsynced Bybit client
 * fails `fetchBalance` with `10002`, ccxt maps that to `InvalidNonce`, and the validation error
 * mapper reports it as "Invalid API key, secret, or passphrase." A member with a perfectly good
 * key is told their key is bad.
 */
export const clockOffsetFor = (exchange: string): Promise<number> => clockSkewFor(exchange);

/** The adapter for a venue, or `UNSUPPORTED_EXCHANGE` when the engine cannot trade it. */
export function adapterFor(exchange: string): VenueAdapter {
  const adapter = ADAPTERS[exchange];
  if (!adapter) throw new Error(`UNSUPPORTED_EXCHANGE:${exchange}`);
  return adapter;
}

/** The venue's paper stand-in symbol, or null when its demo lists everything. */
export function demoFallbackFor(exchange: string): string | null {
  return ADAPTERS[exchange]?.demoFallbackSymbol ?? null;
}

/**
 * The venue name for a live client, reversed from its ccxt id.
 *
 * Exists so a function that already has an `Exchange` never needs the venue passed alongside
 * it. That is not a convenience: `(ex, symbol)` and `(ex, exchange, symbol)` are both
 * all-strings, so adding a venue parameter to an existing helper type-checks at every one of
 * its call sites while silently shifting every argument by one. Deriving it removes the
 * opportunity.
 */
export function venueOf(ex: Exchange): string {
  const found = Object.entries(ADAPTERS).find(([, adapter]) => adapter.ccxtId === ex.id);
  if (!found) throw new Error(`UNSUPPORTED_EXCHANGE:${ex.id}`);
  return found[0];
}

// Drift guard. A venue marked `wired` with no adapter here would pass every gate and then
// throw UNSUPPORTED_EXCHANGE per signal. Dev-only warn, mirroring lib/account.ts.
if (process.env.NODE_ENV !== "production") {
  const orphaned = BOT_EXCHANGES.filter((venue) => venue.wired && !ADAPTERS[venue.value]).map((v) => v.value);
  if (orphaned.length > 0) {
    console.warn(`[client] venues flagged wired with no ccxt adapter: ${orphaned.join(", ")} — they will throw UNSUPPORTED_EXCHANGE`);
  }
}

// Promise-per-venue, not result-per-venue, so concurrent cold requests share one import.
const ctorPromises = new Map<string, Promise<ExchangeCtor>>();
const importSources = new Map<string, string>();

/** Which import path each venue's cold start took. Logged, not branched on. */
export const ccxtImportSource = (): string | null => {
  if (importSources.size === 0) return null;
  return [...importSources].map(([id, source]) => `${id}:${source}`).join(" ");
};

/**
 * Force the ccxt imports now, so an order doesn't pay for them later. Called once at server
 * boot from instrumentation.ts; the module-scope cache does the rest.
 *
 * Warms every WIRED venue, and never rejects — a venue whose import fails simply pays it on
 * first use, which must not keep the site down.
 */
export async function warmCcxt(): Promise<{ importSource: string; ms: number }> {
  const started = Date.now();
  const venues = BOT_EXCHANGES.filter((venue) => venue.wired && ADAPTERS[venue.value]).map((v) => v.value);
  await Promise.all(venues.map((venue) => venueCtor(venue).catch(() => null)));
  // Measure any clock-sensitive venue's skew here too, so the first signed call reads a memo
  // instead of paying a round-trip in front of a market fill.
  await Promise.all(venues.map((venue) => clockSkewFor(venue).catch(() => 0)));
  return { importSource: ccxtImportSource() ?? "none", ms: Date.now() - started };
}

/**
 * Import ONE exchange rather than all ~100 ccxt exchanges.
 *
 * ccxt's `exports` map exposes only ".", so `import("ccxt/js/src/bitget.js")` is an
 * ERR_PACKAGE_PATH_NOT_EXPORTED. We resolve the package root and import the file by absolute
 * URL instead, hidden from the bundlers so they leave it as a runtime import. A computed path
 * is invisible to file tracing, so the deep module can be absent if the build is ever pruned —
 * hence the fallback, which is correct, just slower to boot.
 *
 * Verified to work for every venue in ADAPTERS: each `js/src/<id>.js` exists and pulls in only
 * `./abstract/<id>.js` plus base helpers, so the tree-shaking benefit holds per venue.
 */
async function importVenue(ccxtId: string): Promise<ExchangeCtor> {
  try {
    const req = createRequire(path.join(process.cwd(), "index.js"));
    const entry = req.resolve("ccxt").split(path.sep).join("/");
    const marker = "/node_modules/ccxt/";
    const at = entry.lastIndexOf(marker);
    if (at !== -1) {
      const url = pathToFileURL(`${entry.slice(0, at + marker.length)}js/src/${ccxtId}.js`).href;
      const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
      const Ctor = (mod.default ?? mod) as ExchangeCtor;
      if (typeof Ctor === "function") {
        importSources.set(ccxtId, `${ccxtId}-only`);
        return Ctor;
      }
    }
  } catch {
    // Deep import unavailable (bundled, traced away, or layout changed) — fall back.
  }
  const ccxt = await import("ccxt");
  importSources.set(ccxtId, "full-ccxt");
  const Ctor = (ccxt as unknown as Record<string, ExchangeCtor | undefined>)[ccxtId];
  if (!Ctor) throw new Error(`UNSUPPORTED_EXCHANGE:${ccxtId}`);
  return Ctor;
}

function venueCtor(exchange: string): Promise<ExchangeCtor> {
  const { ccxtId } = adapterFor(exchange);
  let pending = ctorPromises.get(ccxtId);
  if (!pending) {
    pending = importVenue(ccxtId).catch((error) => {
      ctorPromises.delete(ccxtId); // a failed import must not poison the instance
      throw error;
    });
    ctorPromises.set(ccxtId, pending);
  }
  return pending;
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
    const adapter = adapterFor(exchange);
    const Ctor = await venueCtor(exchange);

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ex = new Ctor({ enableRateLimit: true, timeout: 15_000, options: { ...adapter.options } });
      ex.has["fetchCurrencies"] = false;
      adapter.paperMode(ex, sandbox);
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
  const adapter = adapterFor(exchange);
  const Ctor = await venueCtor(exchange);
  // Warm after the first call, so this is a memo read rather than a round-trip. Signed calls
  // only — the public market loader never needs it.
  const timeDifference = await clockSkewFor(exchange);
  const ex = new Ctor({
    apiKey: creds.apiKey,
    secret: creds.apiSecret,
    // ccxt names the passphrase "password". Undefined for a venue that has none (Bybit),
    // which the adapter simply ignores.
    password: creds.passphrase,
    enableRateLimit: true,
    timeout: 10_000,
    options: { ...adapter.options, ...(adapter.syncClock ? { timeDifference } : {}) },
  });
  adapter.paperMode(ex, creds.sandbox);
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
