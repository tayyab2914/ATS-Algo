/**
 * The venues we support. Single source of truth for per-exchange facts, used both
 * by the admin bot editor (which venue a bot's signals run on, with a logo served
 * from `public/exchanges/`) and by the Account → Exchange API Connections flow
 * (which venues a user can connect a key to, and how to validate it).
 */
export type BotExchange = {
  value: string;
  label: string;
  logo: string;
  /** ccxt constructor id used to authenticate/trade on this venue. */
  ccxtId: string;
  /** Whether the venue's API auth requires a passphrase (Bitget / OKX-style). */
  requiresPassphrase: boolean;
  /**
   * Whether the CONNECT surface is open: the Account form, the readiness check, the
   * key-validation route. Says nothing about whether a signal can actually execute.
   */
  connectable: boolean;
  /**
   * Whether the EXECUTION ENGINE can trade this venue: `lib/execution/client.ts` can
   * build a client for it, and the stop ladder has been proven against it.
   *
   * Set this true ONLY after the venue's stop primitives are proven on its paper
   * engine — not when the ccxt adapter merely exposes the calls. Nothing in the stop
   * ladder transfers by assumption: the never-naked backstop, the movable stop's
   * order family, duplicate-client-id rejection and fill attribution are all
   * venue-specific facts that were established against Bitget's paper venue.
   */
  wired: boolean;
};

export const BOT_EXCHANGES: BotExchange[] = [
  // Bybit needs NO passphrase (ccxt's bybit adapter has no `requiredCredentials`
  // override, so it inherits `password: false`).
  // Wired 2026-08-03. Proven end-to-end on the demo engine by
  // scripts/verify-executor-bybit-demo.ts (entry + attached backstop + 6-rung ladder + ratchet
  // + flatten) and scripts/verify-stop-strategy.ts (the one-slot stop model).
  { value: "Bybit", label: "Bybit", logo: "/exchanges/bybit.svg", ccxtId: "bybit", requiresPassphrase: false, connectable: true, wired: true },
  { value: "Bitget", label: "Bitget", logo: "/exchanges/bitget.svg", ccxtId: "bitget", requiresPassphrase: true, connectable: true, wired: true },
  // Blofin DOES require a passphrase — confirmed against the installed ccxt adapter, which sets
  // `requiredCredentials.password: true` and sends it as ACCESS-PASSPHRASE. The member CHOOSES it
  // at key creation (4-20 chars, letters/numbers/underscore only) and it is not recoverable.
  //
  // Wired 2026-08-05. Proven end-to-end on the demo engine by
  // scripts/verify-executor-blofin-demo.ts (contract-denominated sizing, the readFill seam this
  // venue needs because it has no fetchOrder, entry + 6-rung ladder + two ratchet generations
  // with the backstop surviving both, flatten) and scripts/probe-blofin-stops.ts (a sized
  // reduce-only TPSL is NOT starved by a full ladder — the question that could have sunk it).
  { value: "Blofin", label: "Blofin", logo: "/exchanges/blofin.svg", ccxtId: "blofin", requiresPassphrase: true, connectable: true, wired: true },
];

/** Look up a venue's metadata by name, case-insensitively. */
export function exchangeMeta(name: string | undefined | null): BotExchange | undefined {
  if (!name) return undefined;
  return BOT_EXCHANGES.find((e) => e.value.toLowerCase() === name.toLowerCase());
}

/** Whether a venue's API auth requires a passphrase. */
export function exchangeRequiresPassphrase(name: string): boolean {
  return exchangeMeta(name)?.requiresPassphrase ?? false;
}

/**
 * Whether a venue is supported END TO END — connectable *and* wired for execution.
 *
 * THE SINGLE PREDICATE. Every gate reads this one: the Account connect form, the
 * key-validation route, deployment readiness, and — critically — the executor
 * (`fanOut`, `prepareDeployment`, `scanForOrphans`). It exists because those two
 * halves used to disagree: the connect surface read `enabled` while the executor
 * carried its own `chosen !== "Bitget"` whitelist. Opening one without the other let
 * a member store a validated key, pick the venue, and activate — and then every
 * signal was silently dropped as `fanout.skip.exchangeNotWired`, with nothing
 * user-visible to explain it. Requiring BOTH flags here makes that state
 * unreachable rather than merely unlikely.
 *
 * So a venue becomes live in exactly one place: flip `wired` once its stop ladder is
 * proven, flip `connectable` to open the form. Neither alone does anything.
 */
export function exchangeEnabled(name: string): boolean {
  const meta = exchangeMeta(name);
  return Boolean(meta?.connectable && meta?.wired);
}

/** The ccxt constructor id for a venue, or undefined if unknown. */
export function ccxtIdFor(name: string): string | undefined {
  return exchangeMeta(name)?.ccxtId;
}

/** Match a free-form name (e.g. from a JSON config) to a known exchange. */
export function matchBotExchange(name: string | undefined | null): string {
  return exchangeMeta(name)?.value ?? "";
}

/**
 * The exchange a deployment actually runs on, given the user's pick and the bot's
 * admin-allowed set: the user's `exchangeSource` if it's still allowed; else the
 * only allowed exchange when there's just one; else null (multiple allowed and the
 * user hasn't chosen one yet).
 */
export function chosenExchange(
  exchangeSource: string | null | undefined,
  exchanges: string[],
): string | null {
  if (exchangeSource && exchanges.includes(exchangeSource)) return exchangeSource;
  if (exchanges.length === 1) return exchanges[0];
  return null;
}
