import {
  RISK_TO_PROFILE,
  roundMetrics,
  type BacktestResult,
  type ProfileMetrics,
  type RiskClass,
} from "@/lib/backtest/engine";
import { cn } from "@/lib/cn";
import { RISK_LABEL, riskBadgeClass } from "@/lib/risk";

/**
 * Shared read-out of a backtest run: a headline row for the selected risk
 * class, the trailing-window performance tiles, and an all-profiles summary.
 * Used by both the new-bot wizard and the edit-bot flow.
 */
export function BacktestResults({
  name,
  timeframe,
  riskClass,
  result,
}: {
  name: string;
  timeframe: string;
  riskClass: RiskClass;
  result: BacktestResult;
}) {
  const m = roundMetrics(result.profiles[RISK_TO_PROFILE[riskClass]]);
  const pct = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
  const tone = (x: number) => (x >= 0 ? "text-success" : "text-[#D2031E]");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">
        Backtested {result.candleCount.toLocaleString()} candles over {result.windowDays} days. Headline row is the{" "}
        <span className="text-white">{riskClass.toLowerCase()}</span> profile.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-4 py-3">Bot Name</th>
              <th className="px-4 py-3 text-center">Timeframe</th>
              <th className="px-4 py-3 text-center">Risk Class</th>
              <th className="px-4 py-3 text-center">Trades</th>
              <th className="px-4 py-3 text-center">Win Rate</th>
              <th className="px-4 py-3 text-center">PF</th>
              <th className="px-4 py-3 text-center">Return</th>
              <th className="px-4 py-3 text-center">Avg. Trade</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-4 font-semibold text-white">{name || "—"}</td>
              <td className="px-4 py-4 text-center text-muted">{timeframe || "—"}</td>
              <td className="px-4 py-4 text-center">
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", riskBadgeClass(riskClass))}>
                  {RISK_LABEL[riskClass]}
                </span>
              </td>
              <td className="px-4 py-4 text-center text-white">{m.trades}</td>
              <td className="px-4 py-4 text-center text-white">{m.winRate.toFixed(2)}%</td>
              <td className="px-4 py-4 text-center text-white">{m.profitFactor.toFixed(2)}</td>
              <td className={cn("px-4 py-4 text-center font-semibold", tone(m.totalReturn))}>{pct(m.totalReturn)}</td>
              <td className="px-4 py-4 text-center text-white">{m.avgTrade.toFixed(2)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["30 Days", m.d30], ["90 Days", m.d90], ["180 Days", m.d180], ["360 Days", m.d360]] as const).map(([label, v]) => (
          <div key={label} className="rounded-2xl border border-line bg-background p-4">
            <p className="text-xs text-muted">{label}</p>
            <p className={cn("mt-1 text-lg font-semibold", tone(v))}>{pct(v)}</p>
          </div>
        ))}
      </div>

      <PerProfile result={result} />
    </div>
  );
}

function PerProfile({ result }: { result: BacktestResult }) {
  const rows: { key: keyof BacktestResult["profiles"]; label: string }[] = [
    { key: "safe", label: "Low" },
    { key: "balanced", label: "Medium" },
    { key: "aggressive", label: "High" },
  ];
  const cell = (m: ProfileMetrics) =>
    `${m.trades} trades · ${m.winRate.toFixed(1)}% win · PF ${m.profitFactor.toFixed(2)} · ${m.totalReturn >= 0 ? "+" : ""}${m.totalReturn.toFixed(1)}%`;
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className="mb-2 text-xs font-semibold text-muted">All profiles</p>
      <ul className="flex flex-col gap-1 text-xs text-muted">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="inline-block w-16 text-white">{r.label}</span>
            {cell(roundMetrics(result.profiles[r.key]))}
          </li>
        ))}
      </ul>
    </div>
  );
}
