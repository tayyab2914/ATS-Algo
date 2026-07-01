import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { BotDetailActions } from "@/components/my-bots/BotDetailActions";
import { MockAreaChart } from "@/components/my-bots/MockAreaChart";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/db";

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

export async function generateMetadata({ params }: PageProps<"/my-bots/[botId]">): Promise<Metadata> {
  const { botId } = await params;
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { name: true } });
  return { title: bot ? `${bot.name} · My Bots` : "My Bots" };
}

/** Loads the signed-in member's deployment of this bot (or null). */
async function getUserBot(userId: string, botId: string) {
  return prisma.userBot.findUnique({
    where: { userId_botId: { userId, botId } },
    select: {
      active: true,
      allocatedCapital: true,
      bot: { select: { id: true, name: true, ticker: true, exchange: true, riskClass: true } },
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
  const subtitle = [bot.ticker, bot.exchange, `${money(allocatedCapital)} Allocated`].filter(Boolean).join(" · ");

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
        <BotDetailActions botId={bot.id} active={active} />
      </div>

      {/* title */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">Bot Details — {bot.name}</h1>
        <p className="text-sm leading-[21px] text-muted">{subtitle}</p>
      </header>

      {/* active position banner */}
      <p className="text-base font-semibold text-white">
        Active Position: <span className="text-success">LONG</span>
      </p>

      {/* status cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Status" value="In Position" tone="success" />
        <StatCard label="Position" value={`Long ${bot.ticker ?? "BTC/USDT"}`} />
        <StatCard label="Entry Price" value="$67,842.50" />
        <StatCard label="Current Profit" value="+$284.60" tone="success" />
      </div>

      {/* Trade Profile */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-white">Trade Profile</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left">
            <thead>
              <tr className="border-b border-line text-xs font-semibold text-muted">
                <th className="px-2 py-3 text-left">Take Profit</th>
                <th className="px-2 py-3 text-left">Target</th>
                <th className="px-2 py-3 text-right">Allocation</th>
              </tr>
            </thead>
            <tbody>
              {TRADE_PROFILE.map((row, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <td className="px-2 py-4 text-sm font-semibold text-white">Take profit {i + 1}</td>
                  <td className="px-2 py-4 text-sm font-semibold text-success">{row.target}</td>
                  <td className="px-2 py-4 text-right text-sm text-muted">{row.allocation} of assets</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* metrics grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {METRICS.map((m) => (
          <StatCard key={m.label} label={m.label} value={m.value} tone={m.tone} />
        ))}
      </div>

      {/* Trade Visualization */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold text-white">Trade Visualization</h2>
        <MockAreaChart id="trade-viz" />
      </section>

      {/* Performance Summary */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-white">Performance Summary</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {PERFORMANCE.map((p) => (
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
      </section>

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

      {/* Bot Activity Timeline */}
      <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <h2 className="mb-5 text-base font-semibold text-white">Bot Activity Timeline</h2>
        <ol className="flex flex-col">
          {TIMELINE.map((ev, i) => {
            const last = i === TIMELINE.length - 1;
            return (
              <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
                {!last && <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-line" />}
                <span
                  aria-hidden
                  className={cn(
                    "relative z-[1] mt-1 size-2.5 shrink-0 rounded-full",
                    i === 0 ? "bg-accent shadow-[0_0_8px_rgba(40,184,213,0.7)]" : "bg-line",
                  )}
                />
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold text-white">{ev.title}</p>
                  <span className="text-xs text-muted">{ev.time}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </AppShell>
  );
}

/* ── Static demo data (no execution engine yet) ────────────────────────── */

const TRADE_PROFILE = [
  { target: "1.44%", allocation: "7%" },
  { target: "3.61%", allocation: "38%" },
  { target: "4.28%", allocation: "19%" },
  { target: "5.24%", allocation: "18%" },
  { target: "6.16%", allocation: "8%" },
  { target: "8.52%", allocation: "10%" },
];

type Tone = "default" | "success" | "danger";

const METRICS: { label: string; value: string; tone?: Tone }[] = [
  { label: "Stop Loss", value: "3%", tone: "danger" },
  { label: "SL to BE", value: "TP1" },
  { label: "Leverage", value: "7x" },
  { label: "Trade Count", value: "33" },
  { label: "Winrate", value: "68.2%", tone: "success" },
  { label: "Net Profit", value: "788.33%", tone: "success" },
  { label: "Max Drawdown", value: "-27.33%", tone: "danger" },
  { label: "Avg. Trade Profit", value: "23.86%", tone: "success" },
];

const PERFORMANCE: { label: string; value: string; tone?: Tone; icon: React.ReactNode }[] = [
  { label: "Total Trades", value: "1,247", icon: <BarIcon /> },
  { label: "Win Rate", value: "68.2%", icon: <TargetIcon /> },
  { label: "Total Profit", value: "+$4,820", icon: <DollarIcon /> },
  { label: "Max Drawdown", value: "-8.1%", tone: "danger", icon: <WarnIcon /> },
  { label: "Avg Duration", value: "24m", icon: <ClockIcon /> },
];

const TIMELINE = [
  { title: "Opened Long BTC/USDT at $67,842.50", time: "2 min ago" },
  { title: "TP2 hit — Partial close at $71,100", time: "18 min ago" },
  { title: "TP1 hit — Partial close at $69,470", time: "42 min ago" },
  { title: "TradingView signal received: BUY BTC", time: "45 min ago" },
  { title: "Stop Loss updated to $66,900 (Break-Even)", time: "1h ago" },
  { title: "Opened Long BTC/USDT at $66,200", time: "3h ago" },
];

/* ── Presentational bits ───────────────────────────────────────────────── */

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
