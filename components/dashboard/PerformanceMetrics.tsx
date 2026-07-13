import { MetricCard } from "@/components/dashboard/MetricCard";
import { PeriodTabs } from "@/components/dashboard/PeriodTabs";
import type { DashboardData } from "@/lib/dashboard/metrics";
import { PERIOD_DAYS } from "@/lib/dashboard/window";

export function PerformanceMetrics({ data }: { data: DashboardData }) {
  const days = PERIOD_DAYS[data.period];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold leading-6 text-white">Performance Metrics</h2>
          <p className="text-xs text-muted">
            {data.hasLive
              ? `Realized across trades closed in the last ${days} days.`
              : `No trades closed in the last ${days} days — showing the catalogue's backtested figures.`}{" "}
            Windows are UTC+2.
          </p>
        </div>
        <PeriodTabs active={data.period} timeframe={data.timeframe} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>
    </section>
  );
}
