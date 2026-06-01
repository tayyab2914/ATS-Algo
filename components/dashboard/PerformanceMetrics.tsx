import { ChevronDown } from "@/components/dashboard/icons";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { METRICS } from "@/lib/dashboard-data";

export function PerformanceMetrics() {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold leading-6 text-white">Performance Metrics</h2>
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-muted">
          <span>30 D</span>
          <ChevronDown className="text-muted" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {METRICS.map((metric) => (
          <MetricCard key={metric.id} metric={metric} />
        ))}
      </div>
    </section>
  );
}
