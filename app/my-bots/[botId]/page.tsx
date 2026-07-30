import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { ArmLiveToggle } from "@/components/my-bots/ArmLiveToggle";
import { BotDetailActions } from "@/components/my-bots/BotDetailActions";
import { MonthlyBreakdown } from "@/components/my-bots/MonthlyBreakdown";
import { TradeHistory } from "@/components/my-bots/TradeHistory";
import { MultiLineChart } from "@/components/dashboard/MultiLineChart";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";
import type { BotConfig } from "@/lib/bot-config";
import { chosenExchange } from "@/lib/bot-exchanges";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/db";
import { loadLiveView, relativeTime } from "@/lib/my-bots/live-view";

/** Risk class → the profile label the design uses. */
const PROFILE_LABEL: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
  LOW: "Conservative",
  MEDIUM: "Balanced",
  HIGH: "Aggressive",
};
const PROFILE_TAGLINE: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
  LOW: "Low Risk • Capital Preservation",
  MEDIUM: "Medium Risk • Optimized Return",
  HIGH: "High Risk • Maximum Return",
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Loads the signed-in member's deployment of this bot (or null). */
async function getUserBot(userId: string, botId: string) {
  return prisma.userBot.findUnique({
    where: { userId_botId: { userId, botId } },
    select: {
      id: true,
      active: true,
      allocatedCapital: true,
      allocationType: true,
      capitalPerTrade: true,
      exchangeSource: true,
      liveArmed: true,
      bot: { select: { id: true, name: true, ticker: true, exchanges: true, riskClass: true, config: true } },
    },
  });
}

export default async function MyBotDetailPage({ params }: PageProps<"/my-bots/[botId]">) {
  const { botId } = await params;
  const { session, tier, entitled } = await getPageAccess();
  blockExpiredGuest(tier);

  // Only members can deploy bots, so only members have detail pages to view.
  if (!session || !entitled) notFound();

  const userBot = await getUserBot(session.sub, botId);
  if (!userBot) notFound();

  const { bot, active, allocatedCapital } = userBot;
  // The exchange this deployment runs on: the user's pick from the admin-allowed set.
  const chosen = chosenExchange(userBot.exchangeSource, bot.exchanges);
  const subtitle = [bot.ticker, chosen ?? bot.exchanges[0], `${money(allocatedCapital)} Allocated`]
    .filter(Boolean)
    .join(" · ");

  // The member's connection for the chosen exchange: gates activation, and its
  // auto-detected demo/live mode decides whether live-arming is even offered.
  const connection = chosen
    ? await prisma.exchangeConnection.findUnique({
        where: { userId_exchange: { userId: session.sub, exchange: chosen } },
        select: { apiKeyEnc: true, sandbox: true },
      })
    : null;
  const connected = Boolean(connection?.apiKeyEnc);
  // Only a real (non-sandbox) key can arm live trading; a demo key never can.
  const isLiveKey = connected && connection?.sandbox === false;

  // Everything below comes from the positions and orders the engine actually placed.
  const view = await loadLiveView(userBot.id, bot.config as unknown as BotConfig, bot.riskClass);
  const { profile, open, performance, trades, monthly, timeline } = view;
  const signed = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toFixed(2)}`;
  // The ratchet walks the stop past entry to lock profit — a strictly-beyond-entry stop is
  // more than "break-even", so it earns its own label.
  const stopBeyondEntry = open
    ? open.side === "LONG"
      ? open.stopPrice > open.entryPrice
      : open.stopPrice < open.entryPrice
    : false;

  return (
    <AppShell>
      {/* top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/my-bots"
          className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-white"
        >
          <BackArrow />
          Back to My Bots
        </Link>
        <BotDetailActions
          botId={bot.id}
          active={active}
          exchanges={bot.exchanges}
          chosen={chosen}
          connected={connected}
          capitalPerTrade={userBot.capitalPerTrade}
          allocationType={userBot.allocationType}
          allocatedCapital={allocatedCapital}
        />
      </div>

      {/* title */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">Bot Details — {bot.name}</h1>
        <p className="text-sm leading-[21px] text-muted">{subtitle}</p>
      </header>

      {/* Live trading is armed per deployment, and only ever for a real key. */}
      {isLiveKey && <ArmLiveToggle botId={bot.id} initialArmed={userBot.liveArmed} />}

      {/* Active position — or an honest empty state. */}
      {open ? (
        <>
          <p className="text-base font-semibold text-white">
            Active Position:{" "}
            <span className={open.side === "LONG" ? "text-success" : "text-[#D2031E]"}>{open.side}</span>
            {open.sandbox && <span className="ml-2 rounded-full bg-white/5 px-2 py-0.5 text-xs text-muted">paper</span>}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Status" value="In Position" tone="success" />
            <StatCard label="Position" value={`${open.side === "LONG" ? "Long" : "Short"} ${open.symbol}`} />
            <StatCard label="Entry Price" value={`$${open.entryPrice.toLocaleString("en-US")}`} />
            <StatCard
              label={stopBeyondEntry ? "Stop (profit locked)" : open.beMoved ? "Stop (break-even)" : "Stop Loss"}
              value={`$${open.stopPrice.toLocaleString("en-US")}`}
              tone={open.beMoved ? "success" : "danger"}
            />
            <StatCard
              label="Unrealized PnL"
              value={open.unrealizedPnl != null ? signed(open.unrealizedPnl) : "—"}
              tone={open.unrealizedPnl == null ? "default" : open.unrealizedPnl >= 0 ? "success" : "danger"}
            />
            {open.markPrice != null && (
              <StatCard label="Mark Price" value={`$${open.markPrice.toLocaleString("en-US")}`} />
            )}
          </div>
          {open.markedAt ? (
            <p className="text-xs text-muted">Live figures updated {relativeTime(open.markedAt)}, on each sync.</p>
          ) : (
            <p className="text-xs text-muted">Unrealized PnL fills in on the next sync (within a minute of opening).</p>
          )}
        </>
      ) : (
        <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
          No open position. {active ? "This bot is active and waiting for its next signal." : "Activate the bot to start trading its signals."}
        </div>
      )}

      {/* Trade Profile — the ladder this bot actually places, from its own config. */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-white">Trade Profile</h2>
        {profile ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-line text-xs font-semibold text-muted">
                  <th className="px-2 py-3 text-left">Take Profit</th>
                  <th className="px-2 py-3 text-left">Target</th>
                  <th className="px-2 py-3 text-right">Allocation</th>
                  {open && <th className="px-2 py-3 text-right">Status</th>}
                </tr>
              </thead>
              <tbody>
                {profile.tp.map((target, i) => {
                  const filled = open?.rungs.find((r) => r.rungIndex === i)?.filled ?? false;
                  return (
                    <tr key={i} className="border-b border-line/60 last:border-0">
                      <td className="px-2 py-4 text-sm font-semibold text-white">Take profit {i + 1}</td>
                      <td className="px-2 py-4 text-sm font-semibold text-success">{target}%</td>
                      <td className="px-2 py-4 text-right text-sm text-muted">
                        {Math.round((profile.w[i] ?? 0) * 100)}% of assets
                      </td>
                      {open && (
                        <td className={cn("px-2 py-4 text-right text-sm", filled ? "text-success" : "text-muted")}>
                          {filled ? "Filled" : "Resting"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted">This bot&apos;s config has no {bot.riskClass.toLowerCase()} profile.</p>
        )}
      </section>

      {/* Live metrics — the bot's own risk settings plus this deployment's real record. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Stop Loss" value={profile ? `${profile.sl}%` : "—"} tone="danger" />
        {profile?.sl_tighten_pct ? (
          <StatCard label="Stop ratchet" value={`${profile.sl_tighten_pct}%/TP`} tone="success" />
        ) : (
          <StatCard label="SL to BE" value={profile?.be ? `TP${profile.be}` : "Never"} />
        )}
        <StatCard label="Leverage" value={profile ? `${profile.lev}x` : "—"} />
        <StatCard label="Trades Closed" value={String(performance.trades)} />
        <StatCard
          label="Win Rate"
          value={performance.trades ? `${performance.winRate.toFixed(1)}%` : "—"}
          tone={performance.trades && performance.winRate >= 50 ? "success" : "default"}
        />
        <StatCard
          label="Realized PnL"
          value={performance.trades ? signed(performance.realizedPnl) : "—"}
          tone={performance.realizedPnl >= 0 ? "success" : "danger"}
        />
        <StatCard label="Max Drawdown" value={performance.trades ? `-$${performance.maxDrawdown.toFixed(2)}` : "—"} tone="danger" />
        <StatCard label="Avg. Trade" value={performance.trades ? signed(performance.avgTrade) : "—"} tone={performance.avgTrade >= 0 ? "success" : "danger"} />
      </div>

      {/* Performance Summary */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-white">Performance Summary</h2>
        {performance.trades === 0 ? (
          <div className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
            No closed trades yet. These fill in from real fills once this bot completes its first trade.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { label: "Total Trades", value: String(performance.trades), icon: <BarIcon /> },
              { label: "Win Rate", value: `${performance.winRate.toFixed(1)}%`, icon: <TargetIcon /> },
              { label: "Realized PnL", value: signed(performance.realizedPnl), tone: performance.realizedPnl < 0 ? "danger" : undefined, icon: <DollarIcon /> },
              { label: "Max Drawdown", value: `-$${performance.maxDrawdown.toFixed(2)}`, tone: "danger" as const, icon: <WarnIcon /> },
              { label: "Avg Duration", value: `${Math.round(performance.avgDurationMin)}m`, icon: <ClockIcon /> },
            ].map((p) => (
              <div key={p.label} className="relative isolate flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm text-muted">{p.label}</span>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    {p.icon}
                  </span>
                </div>
                <span className={cn("text-2xl font-semibold", p.tone === "danger" ? "text-[#D2031E]" : "text-white")}>
                  {p.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Equity Curve — cumulative realized PnL after each closed trade. */}
      {performance.trades > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-base font-semibold text-white">Equity Curve</h2>
          <div className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
            <MultiLineChart
              series={[{ label: "Cumulative PnL", color: "#28B8D5", points: [0, ...performance.equity] }]}
              height={220}
            />
            <p className="mt-3 text-xs text-muted">Cumulative realized PnL (USDT) after each closed trade.</p>
          </div>
        </section>
      )}

      {/* Trade History — each closed trade with the engine's own outcome. */}
      <TradeHistory trades={trades} />

      {/* Monthly Breakdown — realized PnL grouped by calendar month. */}
      <MonthlyBreakdown months={monthly} />

      {/* Selected Profile */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-white">Selected Profile</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-accent/10 px-3 py-1.5 text-sm font-semibold text-accent">
            {PROFILE_LABEL[bot.riskClass]} Profile (Selected)
          </span>
          <span className="text-sm text-muted">{PROFILE_TAGLINE[bot.riskClass]}</span>
        </div>
      </section>

      {/* Bot Activity Timeline — every decision the engine actually made. */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="mb-5 text-base font-semibold text-white">Bot Activity Timeline</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. Signals, orders and fills for this bot appear here.</p>
        ) : (
          <ol className="flex flex-col">
            {timeline.map((event, i) => {
              const last = i === timeline.length - 1;
              return (
                <li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
                  {!last && <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-line" />}
                  <span
                    aria-hidden
                    className={cn(
                      "relative z-[1] mt-1 size-2.5 shrink-0 rounded-full",
                      event.level === "error"
                        ? "bg-[#D2031E]"
                        : event.level === "warn"
                          ? "bg-[#F5A524]"
                          : i === 0
                            ? "bg-accent shadow-[0_0_8px_rgba(40,184,213,0.7)]"
                            : "bg-line",
                    )}
                  />
                  <div className="flex flex-col gap-0.5">
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        event.level === "error" ? "text-[#D2031E]" : event.level === "warn" ? "text-[#F5A524]" : "text-white",
                      )}
                    >
                      {event.title}
                    </p>
                    <span className="text-xs text-muted">{relativeTime(event.at)}</span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </AppShell>
  );
}

/* ── Presentational bits ───────────────────────────────────────────────── */

type Tone = "default" | "success" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  default: "text-white",
  success: "text-success",
  danger: "text-[#D2031E]",
};

function StatCard({ label, value, tone = "default" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface p-4">
      <span className="text-xs leading-[18px] text-muted">{label}</span>
      <span className={cn("text-lg font-semibold leading-6", TONE_CLASS[tone])}>{value}</span>
    </div>
  );
}

function BackArrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}
function TargetIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </svg>
  );
}
function DollarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v18M16 7.5C16 6 14.5 5 12 5S8 6 8 8s2 2.5 4 3 4 1.5 4 3.5-1.5 3-4 3-4-1-4-2.5" />
    </svg>
  );
}
function WarnIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 2 20h20L12 3ZM12 9v5M12 17h.01" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
