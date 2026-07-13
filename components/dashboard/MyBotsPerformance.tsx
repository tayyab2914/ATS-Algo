import Link from "next/link";
import { SectionHeading } from "@/components/dashboard/SectionHeading";
import { TimeframeTabs } from "@/components/dashboard/TimeframeTabs";
import { cn } from "@/lib/cn";
import { format, type MyBotRow } from "@/lib/dashboard/metrics";
import { TIMEFRAME_LABEL, type Period, type Timeframe } from "@/lib/dashboard/window";

/**
 * The member's own deployments. P&L is realized inside the selected calendar
 * window — a window only live trades can answer, which is why this control lives
 * here and not over the catalogue's backtested metrics.
 */
export function MyBotsPerformance({ bots, timeframe, period }: { bots: MyBotRow[]; timeframe: Timeframe; period: Period }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          title="My Bots Performance"
          subtitle={`Realized profit and loss ${TIMEFRAME_LABEL[timeframe].toLowerCase() === "daily" ? "today" : `this ${TIMEFRAME_LABEL[timeframe].toLowerCase().replace(/ly$/, "")}`}.`}
        />
        <div className="flex flex-wrap items-center gap-3">
          <TimeframeTabs active={timeframe} period={period} />
          <Link href="/my-bots" className="text-sm font-semibold text-accent">
            Open My Bots
          </Link>
        </div>
      </div>

      {bots.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
          You haven&apos;t deployed any bots yet. Add one from the Bot Library to see it here.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {bots.map((bot) => (
            <article key={bot.id} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-white">{bot.name}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    bot.active ? "bg-success/10 text-success" : "bg-white/5 text-muted",
                  )}
                >
                  {bot.active ? "active" : "idle"}
                </span>
              </div>
              <div className="flex flex-col gap-3">
                <Row label="Profile" value={bot.profile} />
                <Row label="Capital" value={format.money(bot.capital)} />
                <Row
                  label="P&L"
                  value={bot.pnl === 0 ? "—" : format.signedMoney(bot.pnl)}
                  valueClass={bot.pnl > 0 ? "text-success" : bot.pnl < 0 ? "text-[#D2031E]" : "text-muted"}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function Row({ label, value, valueClass = "text-white" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm font-semibold ${valueClass}`}>{value}</span>
    </div>
  );
}
