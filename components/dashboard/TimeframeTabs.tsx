import Link from "next/link";
import { cn } from "@/lib/cn";
import { TIMEFRAMES, TIMEFRAME_LABEL, type Period, type Timeframe } from "@/lib/dashboard/window";

/**
 * Daily / Weekly / Monthly / Yearly — calendar windows over LIVE trading results,
 * anchored to UTC+2. "Today" and "this week" are answerable only from trades the
 * engine actually closed, never from a backtest, which has no such columns.
 *
 * Preserves `p`, which drives the Performance Metrics grid above.
 */
export function TimeframeTabs({ active, period }: { active: Timeframe; period: Period }) {
  return (
    <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
      {TIMEFRAMES.map((timeframe) => (
        <Link
          key={timeframe}
          href={`/dashboard?p=${period}&tf=${timeframe}`}
          scroll={false}
          aria-current={timeframe === active ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1 text-xs leading-[18px] transition-colors",
            timeframe === active ? "bg-accent font-medium text-[#121212]" : "text-muted hover:text-white",
          )}
        >
          {TIMEFRAME_LABEL[timeframe]}
        </Link>
      ))}
    </div>
  );
}
