import Link from "next/link";
import { cn } from "@/lib/cn";
import { PERIODS, PERIOD_LABEL, type Period } from "@/lib/dashboard/window";
import type { Timeframe } from "@/lib/dashboard/window";

/**
 * The Performance Metrics window: 30D / 90D / 180D / 360D.
 *
 * These four exist because they are exactly the four windowed returns the
 * catalogue publishes (`Bot.d30/d90/d180/d360`). Offering Daily and Weekly here
 * would be offering windows the backtest cannot answer — and an earlier version
 * did, mapping three of them onto `d30` so three tabs showed identical numbers.
 *
 * Preserves `tf`, which drives the member panels below.
 */
export function PeriodTabs({ active, timeframe }: { active: Period; timeframe: Timeframe }) {
  return (
    <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
      {PERIODS.map((period) => (
        <Link
          key={period}
          href={`/dashboard?p=${period}&tf=${timeframe}`}
          scroll={false}
          aria-current={period === active ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 text-xs leading-[18px] transition-colors",
            period === active ? "bg-accent font-medium text-[#121212]" : "text-muted hover:text-white",
          )}
        >
          {PERIOD_LABEL[period]}
        </Link>
      ))}
    </div>
  );
}
