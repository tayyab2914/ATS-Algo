"use client";

import { BOT_EXCHANGES } from "@/lib/bot-exchanges";
import { cn } from "@/lib/cn";

/**
 * Multi-select of the exchanges an admin allows a bot to run on — toggleable
 * logo chips (native <select multiple> can't render logos). Pick one or more;
 * the user later chooses ONE of these for their deployment.
 */
export function ExchangeMultiSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  function toggle(ex: string) {
    onChange(value.includes(ex) ? value.filter((v) => v !== ex) : [...value, ex]);
  }
  return (
    <div className="flex flex-wrap gap-2">
      {BOT_EXCHANGES.map((ex) => {
        const on = value.includes(ex.value);
        return (
          <button
            key={ex.value}
            type="button"
            onClick={() => toggle(ex.value)}
            aria-pressed={on}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors",
              on
                ? "border-accent bg-accent/10 text-white"
                : "border-line bg-background text-muted hover:border-accent/40 hover:text-white",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ex.logo} alt="" width={18} height={18} className="size-[18px] shrink-0 rounded" />
            <span>{ex.label}</span>
            {on && <span className="text-accent">✓</span>}
          </button>
        );
      })}
    </div>
  );
}
