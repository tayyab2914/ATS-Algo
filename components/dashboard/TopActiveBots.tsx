import Link from "next/link";
import { SectionHeading } from "@/components/dashboard/SectionHeading";
import { TAG_ICONS } from "@/components/dashboard/icons";
import { cn } from "@/lib/cn";
import { format, type TopBot } from "@/lib/dashboard/metrics";

/**
 * The member's own best-returning bots that are actually RUNNING — deployed and
 * switched on. When they're running nothing we fall back to their idle
 * deployments, and only for a member with none at all to the published library —
 * saying so either way rather than implying those bots are live.
 */
export function TopActiveBots({ bots, running, deployed }: { bots: TopBot[]; running: boolean; deployed: boolean }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeading
        title={running ? "Your Top Active Bots" : deployed ? "Your Bots" : "Top Published Bots"}
        subtitle={
          running
            ? "Your best performing bots that are currently running."
            : deployed
              ? "None of your bots are switched on — showing your deployments by backtest."
              : "You haven't deployed a bot yet — showing the best published bots by backtest."
        }
      />

      {bots.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
          No bots published yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {bots.map((bot) => (
            <Link
              key={bot.id}
              href={`/bot-library/${bot.id}`}
              className="relative isolate flex flex-col gap-6 overflow-hidden rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-accent/40"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute -left-[45px] -top-[41px] z-0 size-[102px] rounded-full bg-accent/20 blur-[32px]"
              />
              <div className="relative z-[1] flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-white">{bot.name}</span>
                  <span className="text-xs text-muted">{bot.pair}</span>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                    bot.returnPct >= 0 ? "bg-success/10 text-success" : "bg-[#D2031E]/10 text-[#D2031E]",
                  )}
                >
                  {format.signedPct(bot.returnPct)}
                </span>
              </div>

              <div className="relative z-[1] flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <TAG_ICONS.clock className="text-accent" />
                  {bot.timeframe}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <TAG_ICONS.risk className="text-accent" />
                  {bot.risk}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
