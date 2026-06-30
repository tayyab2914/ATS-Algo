import { BOT_EXCHANGES } from "@/lib/bot-exchanges";

/** Renders a bot's exchange with its logo; falls back to plain text or a dash. */
export function ExchangeBadge({ exchange }: { exchange: string | null }) {
  if (!exchange) return <span className="text-muted">—</span>;
  const match = BOT_EXCHANGES.find((e) => e.value.toLowerCase() === exchange.toLowerCase());
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-white">
      {match && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={match.logo} alt="" width={18} height={18} className="size-[18px] shrink-0 rounded" />
      )}
      {match?.label ?? exchange}
    </span>
  );
}
