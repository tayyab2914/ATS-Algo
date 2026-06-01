/** Exchanges shown in the Account Settings → Exchange API Connections list. */
export const EXCHANGES = ["Hyperliquid", "Bitget", "Bybit", "Mexc", "Phemex", "OKX"] as const;

export type ExchangeName = (typeof EXCHANGES)[number];

/** Mask an API key for display/storage (keep only the last 4 chars). */
export function maskApiKey(key: string): string {
  const last4 = key.slice(-4);
  return `••••••••${last4}`;
}
