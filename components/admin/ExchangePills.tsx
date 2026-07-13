import { BOT_EXCHANGES, type BotExchange } from "@/lib/bot-exchanges";

/**
 * A bot's allowed exchanges rendered as discrete pills (logo + name). Used on
 * detail pages, where there's room to show every venue in full — unlike the
 * compact stacked-logo {@link ExchangeCluster} used in dense table rows. Pure
 * server component; wraps to multiple lines when a bot allows many venues.
 */
export function ExchangePills({ exchanges }: { exchanges: string[] }) {
  const metas = exchanges
    .map((e) => BOT_EXCHANGES.find((b) => b.value.toLowerCase() === e.toLowerCase()))
    .filter((m): m is BotExchange => Boolean(m));

  if (metas.length === 0) return <span className="text-sm text-muted">—</span>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {metas.map((m) => (
        <span
          key={m.value}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-background px-2.5 py-1 text-xs font-medium text-white"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.logo} alt="" width={16} height={16} className="size-4 shrink-0 rounded-full" />
          {m.label}
        </span>
      ))}
    </div>
  );
}
