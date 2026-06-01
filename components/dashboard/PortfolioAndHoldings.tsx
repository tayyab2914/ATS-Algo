import { AreaChart } from "@/components/dashboard/AreaChart";
import { Donut } from "@/components/dashboard/Donut";
import { Segmented } from "@/components/dashboard/Segmented";
import { HOLDINGS, PH, PORTFOLIO_MONTHS } from "@/lib/dashboard-data";

export function PortfolioAndHoldings() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {/* Portfolio balance */}
      <section className="relative isolate flex flex-col gap-4 overflow-hidden rounded-2xl border border-line bg-surface p-6 lg:col-span-3">
        <span
          aria-hidden
          className="pointer-events-none absolute -left-[45px] -top-[41px] z-0 size-[120px] rounded-full bg-accent/15 blur-[40px]"
        />
        <div className="relative z-[1] flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Portfolio Balance</span>
            <span className="text-2xl font-semibold leading-[31px] text-white">{PH}</span>
            <span className="text-xs text-success">{PH} today</span>
          </div>
          <Segmented options={["All", "24H", "7D", "30D"]} />
        </div>

        <div className="relative z-[1] flex flex-col gap-2">
          <AreaChart />
          <div className="flex justify-between text-xs text-muted">
            {PORTFOLIO_MONTHS.map((month) => (
              <span key={month}>{month}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Spot holdings */}
      <section className="relative isolate flex flex-col gap-6 overflow-hidden rounded-2xl border border-line bg-surface p-6 lg:col-span-2">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-[45px] -top-[41px] z-0 size-[120px] rounded-full bg-accent/15 blur-[40px]"
        />
        <h2 className="relative z-[1] text-base font-semibold leading-6 text-white">Spot Holdings Overview</h2>

        <div className="relative z-[1] flex items-center gap-6">
          <Donut />
          <ul className="flex flex-1 flex-col gap-3">
            {HOLDINGS.map((holding) => (
              <li key={holding.id} className="flex items-center gap-2 text-sm">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: holding.color }} />
                <span className="flex-1 text-muted">{holding.label}</span>
                <span className="text-white">{PH}</span>
                <span className="w-8 text-right text-muted">{PH}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
