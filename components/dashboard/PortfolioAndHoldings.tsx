import { AreaChart } from "@/components/dashboard/AreaChart";
import { Donut } from "@/components/dashboard/Donut";
import { cn } from "@/lib/cn";
import { format, type DashboardData } from "@/lib/dashboard/metrics";
import { TIMEFRAME_LABEL } from "@/lib/dashboard/window";

/**
 * Portfolio balance and where the member's capital sits.
 *
 * Balance is allocated capital plus realized PnL — the only balance the platform
 * can know, since it never connects to a wallet. The right-hand panel shows capital
 * allocation across the member's bots, not spot holdings, for the same reason.
 */
export function PortfolioAndHoldings({ data }: { data: DashboardData }) {
  const { balance, windowPnl, months, curve, allocation } = data.portfolio;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <section className="relative isolate flex flex-col gap-4 overflow-hidden rounded-2xl border border-line bg-surface p-6 lg:col-span-3">
        <span
          aria-hidden
          className="pointer-events-none absolute -left-[45px] -top-[41px] z-0 size-[120px] rounded-full bg-accent/15 blur-[40px]"
        />
        <div className="relative z-[1] flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted">Portfolio Balance</span>
            <span className="text-2xl font-semibold leading-[31px] text-white">{format.money(balance)}</span>
            <span
              className={cn(
                "text-xs",
                windowPnl > 0 ? "text-success" : windowPnl < 0 ? "text-[#D2031E]" : "text-muted",
              )}
            >
              {windowPnl === 0 ? "No change" : format.signedMoney(windowPnl)} this {TIMEFRAME_LABEL[data.timeframe].toLowerCase().replace(/ly$/, "")}
            </span>
          </div>
          <span className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted">Allocated + realized</span>
        </div>

        <div className="relative z-[1] flex flex-col gap-2">
          <AreaChart points={curve} />
          {months.length > 0 && (
            <div className="flex justify-between text-xs text-muted">
              {months.map((month, index) => (
                <span key={`${month}-${index}`}>{month}</span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="relative isolate flex flex-col gap-6 overflow-hidden rounded-2xl border border-line bg-surface p-6 lg:col-span-2">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-[45px] -top-[41px] z-0 size-[120px] rounded-full bg-accent/15 blur-[40px]"
        />
        <div className="relative z-[1] flex flex-col gap-0.5">
          <h2 className="text-base font-semibold leading-6 text-white">Capital Allocation</h2>
          <p className="text-xs text-muted">How your capital is split across your bots.</p>
        </div>

        {allocation.length === 0 ? (
          <p className="relative z-[1] text-sm text-muted">Allocate capital to a bot to see it here.</p>
        ) : (
          <div className="relative z-[1] flex items-center gap-6">
            <Donut slices={allocation} />
            <ul className="flex flex-1 flex-col gap-3">
              {allocation.map((slice) => (
                <li key={slice.id} className="flex items-center gap-2 text-sm">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                  <span className="min-w-0 flex-1 truncate text-muted">{slice.label}</span>
                  <span className="text-white">{format.money(slice.capital)}</span>
                  <span className="w-10 text-right text-muted">{slice.pct.toFixed(0)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
