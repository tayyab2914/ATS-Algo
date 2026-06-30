/**
 * Exchanges an admin can appoint to a bot when creating it. Distinct from the
 * account-connection list in `lib/account.ts` — these are the venues the bot's
 * signals are executed on. Each carries a logo served from `public/exchanges/`.
 */
export type BotExchange = {
  value: string;
  label: string;
  logo: string;
};

export const BOT_EXCHANGES: BotExchange[] = [
  { value: "Bybit", label: "Bybit", logo: "/exchanges/bybit.svg" },
  { value: "Bitget", label: "Bitget", logo: "/exchanges/bitget.svg" },
  { value: "Blofin", label: "Blofin", logo: "/exchanges/blofin.svg" },
];

/** Match a free-form name (e.g. from a JSON config) to a known exchange, case-insensitively. */
export function matchBotExchange(name: string | undefined | null): string {
  if (!name) return "";
  return BOT_EXCHANGES.find((e) => e.value.toLowerCase() === name.toLowerCase())?.value ?? "";
}
