import "server-only";
import { profileFor, type BotConfig, type RiskClass } from "@/lib/bot-config";
import { exchangeClient, publicPrice } from "@/lib/execution/client";
import { ladderFloorSize, notionalOf } from "@/lib/execution/pricing";
import { resolveSymbol } from "@/lib/execution/symbol";
import { tickerFor } from "@/lib/ticker-map";

/**
 * The smallest capital-per-trade that can actually open a position on this bot.
 *
 * WHY THIS EXISTS. Both floors a trade can hit — the venue's minimum order size and the
 * per-rung minimum every take-profit must clear on its own — were only ever discovered when a
 * signal fired, which on a 150-minute bot is hours or days after the member switched it on. A
 * member sat on two bots for twelve days with $0 of volume and no idea why. This turns that
 * into a number shown next to the field they type it in, and a refusal at the moment they
 * click Activate.
 *
 * Priced at the CURRENT mark, so it moves with the instrument — it is guidance and a gate,
 * never a stored value. `SHORT` is used because a short prices its rungs below entry and so
 * clears a minimum notional least easily: a figure that works for a short works for either.
 *
 * Returns null whenever the answer cannot be established — an unlisted instrument, a venue
 * that will not quote, a ladder no size can place. The callers treat null as "no opinion" and
 * neither show a figure nor block an activation, because a venue hiccup must not become a
 * member's inability to start their bot.
 */
export async function minCapitalPerTrade(
  exchange: string,
  bot: { ticker: string | null; tickerMap?: unknown; config: unknown; riskClass: RiskClass },
): Promise<number | null> {
  const profile = profileFor(bot.config as BotConfig, bot.riskClass);
  if (!profile || !(profile.lev > 0)) return null;

  try {
    // Live markets only. A member's paper key does not change what their funded account needs,
    // and the demo venues substitute instruments, which would quote a floor for the wrong one.
    const { symbol, market } = await resolveSymbol(exchange, tickerFor(bot, exchange), false);
    const price = await publicPrice(exchange, symbol);

    // Markets injected, so this costs a constructor and no network — the rounding has to be the
    // venue's own, because the whole point is the step the engine will truncate to.
    const ex = await exchangeClient(exchange, { apiKey: "", apiSecret: "", sandbox: false }, [market]);
    const round = (n: number) => Number(ex.amountToPrecision(symbol, n));
    const roundPrice = (n: number) => Number(ex.priceToPrecision(symbol, n));

    const floor = ladderFloorSize(price, profile, "SHORT", market, round, roundPrice);
    if (floor === null) return null;

    const contractSize = Number(market.contractSize ?? 1) || 1;
    const margin = notionalOf(floor, price, contractSize) / profile.lev;
    return Number.isFinite(margin) && margin > 0 ? margin : null;
  } catch {
    return null;
  }
}

/** A good answer lives this long. The floor tracks price, which does not move fast enough to care. */
const TTL_MS = 60_000;

/**
 * A failure is cached far more briefly. It is usually a blip, and holding "unknown" for a full
 * minute would silently drop the gate and the hint for every member on that venue meanwhile.
 */
const MISS_TTL_MS = 10_000;

/**
 * How long the venue gets before the answer is abandoned.
 *
 * Both callers are on a request path a member is waiting on — the settings page render and
 * the Activate click. ccxt's own timeout is 10 s and `publicPrice` retries once, so without
 * this a sulking venue turns activation into a ~20 s stall. Three seconds is far more than a
 * ticker needs, and overrunning it degrades to "no opinion", never to a refusal: a member
 * must always be able to start their own bot.
 */
const DEADLINE_MS = 3_000;

const memo = new Map<string, { at: number; value: number | null }>();

/**
 * {@link minCapitalPerTrade}, memoised per (exchange, ticker, leverage) and bounded in time.
 *
 * The figure costs a `fetchTicker` round-trip, and both callers are request-path. Without the
 * memo a member moving between the settings page and the Activate button pays the venue twice
 * in a few seconds for a number that cannot have moved.
 */
export async function cachedMinCapitalPerTrade(
  exchange: string,
  bot: { ticker: string | null; tickerMap?: unknown; config: unknown; riskClass: RiskClass },
): Promise<number | null> {
  const profile = profileFor(bot.config as BotConfig, bot.riskClass);
  const key = `${exchange}|${tickerFor(bot, exchange) ?? ""}|${profile?.lev ?? 0}`;

  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < (hit.value === null ? MISS_TTL_MS : TTL_MS)) return hit.value;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const value = await Promise.race([
    minCapitalPerTrade(exchange, bot),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), DEADLINE_MS);
    }),
  ]).finally(() => clearTimeout(timer));

  memo.set(key, { at: Date.now(), value });
  return value;
}
