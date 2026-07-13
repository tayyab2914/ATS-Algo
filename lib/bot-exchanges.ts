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
  /** Whether users can connect this venue yet; others render as "Coming soon". */
  enabled: boolean;
};

export const BOT_EXCHANGES: BotExchange[] = [
  { value: "Bybit", label: "Bybit", logo: "/exchanges/bybit.svg", ccxtId: "bybit", requiresPassphrase: false, enabled: false },
  { value: "Bitget", label: "Bitget", logo: "/exchanges/bitget.svg", ccxtId: "bitget", requiresPassphrase: true, enabled: true },
  // Blofin is OKX-derived and likely requires a passphrase — RE-VERIFY when the
  // Blofin connection slice is built and before enabling it.
  { value: "Blofin", label: "Blofin", logo: "/exchanges/blofin.svg", ccxtId: "blofin", requiresPassphrase: false, enabled: false },
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

/** Whether a venue is currently connectable (vs "Coming soon"). */
export function exchangeEnabled(name: string): boolean {
  return exchangeMeta(name)?.enabled ?? false;
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
