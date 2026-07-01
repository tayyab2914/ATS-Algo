/** Exchanges shown in the Account Settings → Exchange API Connections list.
 * Kept in sync with the venues we support (see BOT_EXCHANGES). */
export const EXCHANGES = ["Bybit", "Bitget", "Blofin"] as const;

export type ExchangeName = (typeof EXCHANGES)[number];

/** Mask an API key for display/storage (keep only the last 4 chars). */
export function maskApiKey(key: string): string {
  const last4 = key.slice(-4);
  return `••••••••${last4}`;
}
