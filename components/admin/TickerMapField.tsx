"use client";

import { BOT_EXCHANGES } from "@/lib/bot-exchanges";
import { cn } from "@/lib/cn";
import { TICKER_MAX_LENGTH, type TickerMap } from "@/lib/ticker-map";

/**
 * One ticker box per exchange this bot is allowed on.
 *
 * The bot's own ticker is the default for every venue; a box is filled in only
 * where that venue calls the instrument something else. Crypto bots therefore
 * leave every box empty, which is why this renders as a quiet, collapsed row
 * rather than a required field — it exists for commodities and metals, where the
 * venues agree on nothing.
 *
 * Shown only for the venues currently ticked above, because an override for a
 * venue the bot doesn't run on is dropped on save anyway.
 */
export function TickerMapField({
  exchanges,
  value,
  fallback,
  onChange,
}: {
  exchanges: string[];
  value: TickerMap;
  /** The bot's own ticker — what a venue with no override will be asked for. */
  fallback: string | null;
  onChange: (value: TickerMap) => void;
}) {
  function set(venue: string, ticker: string) {
    const next = { ...value };
    // An empty box is "no override", never an empty override — same state the
    // server normalises to, so the dirty check can't disagree with what saves.
    if (ticker.trim()) next[venue] = ticker;
    else delete next[venue];
    onChange(next);
  }

  const venues = BOT_EXCHANGES.filter((ex) => exchanges.includes(ex.value));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-background p-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-white">Ticker per exchange</span>
        <span className="text-xs text-muted">
          Leave these empty when every exchange uses the same name — the bot trades{" "}
          <span className="text-white">{fallback || "its own ticker"}</span> everywhere. Fill one in where
          the exchange calls the instrument something else (WTI oil is{" "}
          <span className="text-white">NCCO1OILWTI2USD</span> on BingX and <span className="text-white">AXTI</span> on
          Bybit). Use the name the exchange itself shows.
        </span>
      </div>

      {venues.length === 0 ? (
        <p className="text-xs text-muted">Pick an exchange above to set its ticker.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {venues.map((ex) => (
            <label key={ex.value} className="flex items-center gap-3">
              <span className="flex w-28 shrink-0 items-center gap-2 text-sm text-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={ex.logo} alt="" width={18} height={18} className="size-[18px] shrink-0 rounded" />
                <span className="truncate">{ex.label}</span>
              </span>
              <input
                value={value[ex.value] ?? ""}
                onChange={(e) => set(ex.value, e.target.value)}
                maxLength={TICKER_MAX_LENGTH}
                spellCheck={false}
                autoComplete="off"
                placeholder={fallback || "Same as the bot's ticker"}
                aria-label={`${ex.label} ticker`}
                className={cn(
                  "h-[42px] w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-sm uppercase text-white",
                  "placeholder:normal-case placeholder:text-muted focus:border-accent/60 focus:outline-none",
                )}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
