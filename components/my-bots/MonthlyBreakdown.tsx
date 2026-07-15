import { cn } from "@/lib/cn";
import type { MonthlyView } from "@/lib/my-bots/live-view";

/**
 * Realized PnL grouped by calendar month — the mid-level view between per-trade history
 * and the lifetime Performance Summary. A thin bar tracks each month's PnL against the
 * best/worst month so the shape is readable at a glance.
 */
export function MonthlyBreakdown({ months }: { months: MonthlyView[] }) {
  if (months.length === 0) return null;
  const signed = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toFixed(2)}`;
  const peak = Math.max(1, ...months.map((m) => Math.abs(m.realizedPnl)));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-white">Monthly Breakdown</h2>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-4 py-3">Month</th>
              <th className="px-4 py-3 text-center">Trades</th>
              <th className="px-4 py-3 text-center">Win Rate</th>
              <th className="px-4 py-3 text-right">Realized PnL</th>
              <th className="px-4 py-3 w-[38%]" />
            </tr>
          </thead>
          <tbody>
            {months.map((month) => {
              const positive = month.realizedPnl >= 0;
              return (
                <tr key={month.key} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-semibold text-white">{month.label}</td>
                  <td className="px-4 py-3 text-center text-muted">{month.trades}</td>
                  <td className="px-4 py-3 text-center text-muted">{month.winRate.toFixed(0)}%</td>
                  <td className={cn("px-4 py-3 text-right font-semibold", positive ? "text-success" : "text-[#D2031E]")}>
                    {signed(month.realizedPnl)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-line/40">
                      <div
                        className={cn("h-full rounded-full", positive ? "bg-success" : "bg-[#D2031E]")}
                        style={{ width: `${(Math.abs(month.realizedPnl) / peak) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
