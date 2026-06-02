import { AdminCard } from "@/components/admin/AdminCard";
import { cn } from "@/lib/cn";

const ROWS = [
  { bot: "Alpha BTC Bot", lastUpdate: "Apr 5, 2026", status: "Active" as const },
  { bot: "ETH Grid Pro", lastUpdate: "Apr 4, 2026", status: "Active" as const },
  { bot: "ETH Grid Pro", lastUpdate: "Apr 3, 2026", status: "Paused" as const },
];

const CHART_URL = "https://www.tradingview.com/chart/";

export function BotCycleTable() {
  return (
    <AdminCard title="Update Bot Cycle" subtitle="Manage bot updates with Super chart links from TradingView.">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-4 py-3 font-semibold">Bot</th>
              <th className="px-4 py-3 text-center font-semibold">Last Update</th>
              <th className="px-4 py-3 text-center font-semibold">Chart Link</th>
              <th className="px-4 py-3 text-center font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, index) => (
              <tr key={`${row.bot}-${index}`} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-4 text-sm font-semibold text-white">{row.bot}</td>
                <td className="px-4 py-4 text-center text-sm text-muted">{row.lastUpdate}</td>
                <td className="px-4 py-4 text-center">
                  <a
                    href={CHART_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#5584FB] underline underline-offset-2"
                  >
                    Trading View Chart
                  </a>
                </td>
                <td className="px-4 py-4 text-center">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-sm font-semibold",
                      row.status === "Active" ? "bg-success/10 text-success" : "bg-muted/10 text-muted",
                    )}
                  >
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}
