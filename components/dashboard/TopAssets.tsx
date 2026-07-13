import { TrendArrow } from "@/components/dashboard/icons";
import { format, type TopPerformer } from "@/lib/dashboard/metrics";

/**
 * The member's bots ranked by realized PnL.
 *
 * The design called this "Top Assets", but the platform deliberately has no wallet
 * connection, so it cannot see anyone's spot balances. What it *can* see, exactly,
 * is what each bot actually earned.
 */
export function TopAssets({ performers }: { performers: TopPerformer[] }) {
  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-line bg-surface p-6">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold leading-6 text-white">Bot Performance</h2>
        <p className="text-xs text-muted">Realized profit and loss across every trade your bots have closed.</p>
      </div>

      {performers.length === 0 ? (
        <p className="text-sm text-muted">No closed trades yet.</p>
      ) : (
        <ul className="flex flex-col">
          {performers.map((performer) => {
            const positive = performer.pnl >= 0;
            return (
              <li key={performer.id} className="flex items-center justify-between gap-3 border-b border-line/60 py-4 last:border-0">
                <span className="min-w-0 truncate text-sm text-white">{performer.name}</span>
                <div className="flex shrink-0 items-center gap-6">
                  <span className={`flex items-center gap-1 text-sm font-medium ${positive ? "text-success" : "text-[#D2031E]"}`}>
                    <TrendArrow up={positive} />
                    {format.signedMoney(performer.pnl)}
                  </span>
                  <span className="w-20 text-right text-sm text-muted">
                    {performer.trades} trade{performer.trades === 1 ? "" : "s"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
