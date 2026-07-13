import { BOT_EXCHANGES } from "@/lib/bot-exchanges";

/** Exchanges shown in the Account Settings → Exchange API Connections list.
 * The literal tuple is kept (zod's `z.enum` needs it to build the `ExchangeName`
 * union), but per-venue facts (ccxt id, passphrase, enabled) live in BOT_EXCHANGES
 * — the single source of truth. The guard below fails loudly if they diverge. */
export const EXCHANGES = ["Bybit", "Bitget", "Blofin"] as const;

export type ExchangeName = (typeof EXCHANGES)[number];

/** Mask an API key for display/storage (keep only the last 4 chars). */
export function maskApiKey(key: string): string {
  const last4 = key.slice(-4);
  return `••••••••${last4}`;
}

// Drift guard: EXCHANGES must mirror BOT_EXCHANGES. Dev-only so a mismatch is
// caught while developing without risking a production crash.
if (process.env.NODE_ENV !== "production") {
  const botValues = new Set(BOT_EXCHANGES.map((e) => e.value));
  const diverged =
    EXCHANGES.length !== botValues.size || EXCHANGES.some((e) => !botValues.has(e));
  if (diverged) {
    console.warn("[account] EXCHANGES and BOT_EXCHANGES have diverged — keep them in sync.");
  }
}
