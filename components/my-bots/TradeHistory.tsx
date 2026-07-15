import { cn } from "@/lib/cn";
import { relativeTime, type ClosedTradeView } from "@/lib/my-bots/live-view";

/**
 * A member's closed trades, newest first — the record the aggregate Performance
 * Summary is built from, broken out per trade. Surfaces the engine's own outcome for
 * each: whether it was stopped out, took the full ladder, or was replaced by a reversal.
 */

const REASON: Record<string, { label: string; cls: string }> = {
  SL: { label: "Stopped out", cls: "bg-[#D2031E]/15 text-[#D2031E]" },
  TP_FULL: { label: "Take-profit", cls: "bg-success/15 text-success" },
  EXIT: { label: "Exit signal", cls: "bg-line/50 text-muted" },
  REVERSAL: { label: "Reversed", cls: "bg-accent/15 text-accent" },
  RECONCILE: { label: "Reconciled", cls: "bg-[#F5A524]/15 text-[#F5A524]" },
};

export function TradeHistory({ trades }: { trades: ClosedTradeView[] }) {
  if (trades.length === 0) return null;
  const signed = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toFixed(2)}`;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold text-white">Trade History</h2>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-4 py-3">Side</th>
              <th className="px-4 py-3">Instrument</th>
              <th className="px-4 py-3 text-right">Entry</th>
              <th className="px-4 py-3 text-right">Realized PnL</th>
              <th className="px-4 py-3 text-center">Outcome</th>
              <th className="px-4 py-3 text-center">TP rungs</th>
              <th className="px-4 py-3 text-right">Closed</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => {
              const reason = REASON[trade.reason] ?? { label: trade.reason, cls: "bg-line/50 text-muted" };
              return (
                <tr key={trade.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-semibold",
                        trade.side === "LONG" ? "bg-success/15 text-success" : "bg-[#D2031E]/15 text-[#D2031E]",
                      )}
                    >
                      {trade.side === "LONG" ? "Long" : "Short"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-white">
                    {trade.symbol}
                    {trade.sandbox ? <span className="ml-1.5 text-[10px] uppercase text-muted">paper</span> : null}
                  </td>
                  <td className="px-4 py-3 text-right text-muted">{trade.entryPrice.toLocaleString("en-US")}</td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right font-semibold",
                      trade.realizedPnl >= 0 ? "text-success" : "text-[#D2031E]",
                    )}
                  >
                    {signed(trade.realizedPnl)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", reason.cls)}>{reason.label}</span>
                  </td>
                  <td className="px-4 py-3 text-center text-muted">
                    {trade.rungsFilled}/{trade.rungsTotal}
                  </td>
                  <td className="px-4 py-3 text-right text-muted">
                    {trade.closedAt ? relativeTime(trade.closedAt) : "—"}
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
