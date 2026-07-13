import { exchangeEnabled } from "@/lib/bot-exchanges";

export type Readiness = { ready: boolean; missing: string[] };

/**
 * What must be configured before a member can ACTIVATE a bot deployment. Pure and
 * client-safe so the same rules drive the server gate (app/api/my-bots/[botId])
 * and the pre-emptive UI (My Bots cards, bot detail actions):
 *  - a per-trade capital amount must be set (Capital Allocation in Settings), and
 *  - the member must have a connected + validated API key for the bot's exchange.
 * Compounding is an on/off preference with a valid default, so it is NOT required.
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
}): Readiness {
  const missing: string[] = [];
  if (!(args.capitalPerTrade > 0)) missing.push("Set capital per trade");
  // A PERCENTAGE bot sizes each trade off the allocated pool, so a zero pool would
  // silently open $0 trades. Require a pool before it can run.
  if (args.allocationType === "PERCENTAGE" && args.allocatedCapital !== undefined && !(args.allocatedCapital > 0)) {
    missing.push("Set allocated capital");
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
