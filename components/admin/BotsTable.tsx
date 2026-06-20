import { AdminCard } from "@/components/admin/AdminCard";
import { BotRowActions } from "@/components/admin/BotRowActions";
import { cn } from "@/lib/cn";

export type BotTableRow = {
  id: string;
  name: string;
  category: string;
  ticker: string | null;
  timeframe: string;
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  status: "ACTIVE" | "DISABLED";
  trades: number;
  winRate: number;
  profitFactor: number;
  d30: number;
  d90: number;
  d180: number;
  d360: number;
  avgTrade: number;
};

const RISK_LABEL = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" } as const;

function Perf({ value }: { value: number }) {
  return (
    <span className={cn("font-semibold", value >= 0 ? "text-success" : "text-[#D2031E]")}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(2)}%
    </span>
  );
}

export function BotsTable({
  bots,
  emptyLabel = "No bots yet. Use “Add New Bot” to create one.",
}: {
  bots: BotTableRow[];
  emptyLabel?: string;
}) {
  return (
    <AdminCard title="Bots" subtitle="Every bot you've created, with its latest backtest metrics.">
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[980px] text-left">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-4 py-3">Bot Name</th>
              <th className="px-4 py-3 text-center">Timeframe</th>
              <th className="px-4 py-3 text-center">Risk Class</th>
              <th className="px-4 py-3 text-center">Win Rate</th>
              <th className="px-4 py-3 text-center">PF</th>
              <th className="px-4 py-3 text-center">30 Days</th>
              <th className="px-4 py-3 text-center">90 Days</th>
              <th className="px-4 py-3 text-center">180 Days</th>
              <th className="px-4 py-3 text-center">360 Days</th>
              <th className="px-4 py-3 text-center">Avg. Trade</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {bots.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-sm text-muted">
                  {emptyLabel}
                </td>
              </tr>
            ) : (
              bots.map((b) => (
                <tr key={b.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-4 text-sm font-semibold text-white">{b.name}</td>
                  <td className="px-4 py-4 text-center text-sm text-muted">{b.timeframe}</td>
                  <td className="px-4 py-4 text-center">
                    <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
                      {RISK_LABEL[b.riskClass]}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center text-sm text-white">{b.winRate.toFixed(2)}%</td>
                  <td className="px-4 py-4 text-center text-sm text-white">{b.profitFactor.toFixed(2)}</td>
                  <td className="px-4 py-4 text-center text-sm"><Perf value={b.d30} /></td>
                  <td className="px-4 py-4 text-center text-sm"><Perf value={b.d90} /></td>
                  <td className="px-4 py-4 text-center text-sm"><Perf value={b.d180} /></td>
                  <td className="px-4 py-4 text-center text-sm"><Perf value={b.d360} /></td>
                  <td className="px-4 py-4 text-center text-sm text-white">{b.avgTrade.toFixed(2)}%</td>
                  <td className="px-4 py-4 text-center">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        b.status === "ACTIVE" ? "bg-success/10 text-success" : "bg-muted/10 text-muted",
                      )}
                    >
                      {b.status === "ACTIVE" ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <BotRowActions botId={b.id} botName={b.name} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </AdminCard>
  );
}
