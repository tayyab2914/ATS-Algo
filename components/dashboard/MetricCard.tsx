import { MetricIcon } from "@/components/dashboard/icons";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { PH, type Metric } from "@/lib/dashboard-data";

/**
 * A single performance-metric card: label + icon chip, a placeholder value, and
 * (for trending metrics) a coloured delta with a sparkline. Mirrors the design's
 * corner glow and top gradient hairline.
 */
export function MetricCard({ metric }: { metric: Metric }) {
  const showFooter = metric.trend === "up";

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

      <span className="relative z-[2] text-xl font-semibold leading-[26px] text-white">{PH}</span>

      {showFooter ? (
        <div className="relative z-[4] flex items-end justify-between">
          <span className="text-xs leading-[18px] text-success">{PH}</span>
          <Sparkline color="#22C55E" />
        </div>
      ) : (
        <div className="h-10" aria-hidden />
      )}
    </article>
  );
}
