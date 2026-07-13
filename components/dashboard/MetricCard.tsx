import { MetricIcon } from "@/components/dashboard/icons";
import { cn } from "@/lib/cn";
import type { DashboardMetric } from "@/lib/dashboard/metrics";

/**
 * One performance metric.
 *
 * The `source` badge is the point: the catalogue's backtested 30-day return and a
 * realized live result are different claims, and a member must never mistake one
 * for the other. "live" is earned; "backtest" is a promise; "—" is honest.
 */
const SOURCE_STYLE: Record<DashboardMetric["source"], string> = {
  live: "bg-success/10 text-success",
  backtest: "bg-white/5 text-muted",
  none: "bg-white/5 text-muted",
};
const SOURCE_LABEL: Record<DashboardMetric["source"], string> = {
  live: "live",
  backtest: "backtest",
  none: "no data",
};

export function MetricCard({ metric }: { metric: DashboardMetric }) {
  return (
    <article className="relative isolate flex h-[138px] flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface p-4">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-[45px] -top-[41px] z-0 size-[102px] rounded-full bg-accent/20 blur-[32px]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 z-[2] h-px w-[236px] -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgba(40,184,213,0.25),transparent)]"
      />

      <div className="relative z-[1] flex items-center justify-between">
        <span className="text-xs leading-[18px] text-muted">{metric.label}</span>
        <span className="flex size-8 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <MetricIcon name={metric.icon} />
        </span>
      </div>

      <span
        className={cn(
          "relative z-[2] text-xl font-semibold leading-[26px]",
          metric.source === "none" ? "text-muted" : "text-white",
        )}
      >
        {metric.value}
      </span>

      <div className="relative z-[4] flex items-end justify-between gap-2">
        <span
          className={cn(
            "truncate text-xs leading-[18px]",
            metric.tone === "success" ? "text-success" : metric.tone === "danger" ? "text-[#D2031E]" : "text-muted",
          )}
        >
          {metric.delta ?? ""}
        </span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", SOURCE_STYLE[metric.source])}>
          {SOURCE_LABEL[metric.source]}
        </span>
      </div>
    </article>
  );
}
