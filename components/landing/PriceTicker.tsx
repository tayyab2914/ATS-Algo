import { TICKERS } from "@/lib/landing-content";
import { cn } from "@/lib/cn";

/**
 * Infinite horizontal price ticker that sits between the hero and the feature
 * sections. The symbol list is rendered twice inside a track translated -50%,
 * so the loop is seamless. Edge-masked so symbols fade in/out at the rails.
 */
export function PriceTicker() {
  const row = [...TICKERS, ...TICKERS];

  return (
    <div className="relative overflow-hidden border-y border-line bg-surface/40 py-4 [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
      <div className="animate-marquee flex w-max items-center gap-3 pr-3">
        {row.map((t, i) => (
          <span
            key={`${t.symbol}-${i}`}
            className="flex items-center gap-2.5 rounded-full border border-line bg-background/60 px-4 py-2 text-sm"
          >
            <span className="font-medium text-white">{t.symbol}</span>
            <span className="text-muted">${t.price}</span>
            <span className={cn("font-semibold", t.up ? "text-success" : "text-[#ff6b6b]")}>
              {t.up ? "▲" : "▼"} {t.change}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
