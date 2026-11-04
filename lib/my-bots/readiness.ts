import { exchangeEnabled } from "@/lib/bot-exchanges";
import { tradeMargin } from "@/lib/execution/pricing";

export type Readiness = { ready: boolean; missing: string[] };

/**
 * Round a minimum UP to a whole dollar before showing it.
 *
 * Never down, and never to cents: the figure is what a member is about to type into a field,
 * and `$137.75` rounded to `$138` has to still clear the floor it came from. The whole class
 * of bug being fixed here is a minimum quoted a hair under the real one.
 */
export const displayMinimum = (amount: number): number => Math.ceil(amount - 1e-9);

/**
 * What must be configured before a member can ACTIVATE a bot deployment. Pure and
 * client-safe so the same rules drive the server gate (app/api/my-bots/[botId])
 * and the pre-emptive UI (My Bots cards, bot detail actions):
 *  - a per-trade capital amount must be set (Capital Allocation in Settings),
 *  - it must be large enough to actually place a trade on the chosen venue, and
 *  - the member must have a connected + validated API key for the bot's exchange.
 * Compounding is an on/off preference with a valid default, so it is NOT required.
 *
 * The size rule arrived late and from a real member: two bots left on for twelve days, $0 of
 * volume, every signal silently refused because $140 was a few dollars under what the bot's
 * take-profit ladder needed. Nothing before this asked the question until a signal fired.
 */
export function botReadiness(args: {
  /** Exchanges the admin allows this bot on. */
  exchanges: string[];
  /** The exchange the user has chosen to run on (null when multiple are allowed and none picked). */
  chosen: string | null;
  /** Whether the user has a connected key for the chosen exchange. */
  connected: boolean;
  capitalPerTrade: number;
  /** How the bot sizes trades. Optional — when omitted, the pool check is skipped. */
  allocationType?: "FIXED" | "PERCENTAGE";
  /** The pool a PERCENTAGE bot sizes off. Optional — checked only when both are given. */
  allocatedCapital?: number;
  /**
   * Smallest per-trade collateral that can actually open this bot on the chosen venue, in USDT
   * — from `minCapitalPerTrade`, which needs live market data and so can only be supplied by a
   * server caller. **Undefined means "unknown", never "no floor"**: the check is skipped, and
   * the engine's own refusal at signal time stays the backstop.
   */
  minCapitalPerTrade?: number;
}): Readiness {
  const missing: string[] = [];
  if (!(args.capitalPerTrade > 0)) missing.push("Set capital per trade");
  // A PERCENTAGE bot sizes each trade off the allocated pool, so a zero pool would
  // silently open $0 trades. Require a pool before it can run.
  if (args.allocationType === "PERCENTAGE" && args.allocatedCapital !== undefined && !(args.allocatedCapital > 0)) {
    missing.push("Set allocated capital");
  }
  // Too small to trade. Compared against the COLLATERAL a trade would actually commit, which
  // for a PERCENTAGE bot is a slice of the pool rather than the number in the field — comparing
  // the raw field would clear a "10%" bot that puts $14 on the table.
  //
  // Only when capital is already set, so a fresh deployment asks for a number before arguing
  // about its size. Compounding is left out on purpose: it would make the gate move with
  // realized PnL, and this is about whether a bot can place its FIRST trade.
  if (args.minCapitalPerTrade !== undefined && args.capitalPerTrade > 0) {
    const margin = tradeMargin({
      allocationType: args.allocationType ?? "FIXED",
      capitalPerTrade: args.capitalPerTrade,
      allocatedCapital: args.allocatedCapital ?? 0,
      realizedBalance: 0,
      compounding: false,
    });
    if (margin > 0 && margin < args.minCapitalPerTrade) {
      missing.push(`Raise capital per trade to at least $${displayMinimum(args.minCapitalPerTrade)}`);
    }
  }
  if (args.exchanges.length === 0) {
    missing.push("No exchange assigned to this bot");
  } else if (!args.chosen) {
    missing.push("Choose an execution exchange");
  } else if (!exchangeEnabled(args.chosen)) {
    missing.push(`${args.chosen} connections are coming soon`);
  } else if (!args.connected) {
    missing.push(`Connect your ${args.chosen} API key`);
  }
  return { ready: missing.length === 0, missing };
}
