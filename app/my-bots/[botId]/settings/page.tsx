import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { BotSettingsForm } from "@/components/my-bots/BotSettingsForm";
import { AreaChart } from "@/components/dashboard/AreaChart";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";
import { chosenExchange } from "@/lib/bot-exchanges";
import { cn } from "@/lib/cn";
import { monthlyCurve } from "@/lib/dashboard/metrics";
import { prisma } from "@/lib/db";

const RISK_EXPOSURE: Record<"LOW" | "MEDIUM" | "HIGH", string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export async function generateMetadata({ params }: PageProps<"/my-bots/[botId]/settings">): Promise<Metadata> {
  const { botId } = await params;
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { name: true } });
  return { title: bot ? `${bot.name} Settings · My Bots` : "Bot Settings" };
}

export default async function BotSettingsPage({ params }: PageProps<"/my-bots/[botId]/settings">) {
  const { botId } = await params;
  const { session, tier, entitled } = await getPageAccess();
  blockExpiredGuest(tier);

  if (!session || !entitled) notFound();

  const userBot = await prisma.userBot.findUnique({
    where: { userId_botId: { userId: session.sub, botId } },
    select: {
      id: true,
      allocationType: true,
      capitalPerTrade: true,
      allocatedCapital: true,
      compounding: true,
      exchangeSource: true,
      realizedBalance: true,
      bot: { select: { id: true, name: true, riskClass: true, exchanges: true } },
      positions: { where: { status: "CLOSED" }, select: { realizedPnl: true, closedAt: true, marginUsed: true } },
    },
  });
  if (!userBot) notFound();

  const { bot } = userBot;

  // This deployment's own record. ROI is measured against the collateral each trade
  // actually committed — the number leverage magnifies — not against the notional.
  const closed = userBot.positions.filter(
    (position): position is { realizedPnl: number; closedAt: Date; marginUsed: number } => position.closedAt !== null,
  );
  const realized = closed.reduce((sum, position) => sum + position.realizedPnl, 0);
  const marginCommitted = closed.reduce((sum, position) => sum + position.marginUsed, 0);
  const roi = marginCommitted > 0 ? (realized / marginCommitted) * 100 : 0;
  const { curve } = monthlyCurve(closed, 8);

  // The admin allows one or more exchanges; the user picks one. Precompute the
  // connection status for EVERY allowed exchange in a single query so switching
  // the pick in the form is instant (no server round-trip per chip click).
  const chosen = chosenExchange(userBot.exchangeSource, bot.exchanges);
  const conns = bot.exchanges.length
    ? await prisma.exchangeConnection.findMany({
        where: { userId: session.sub, exchange: { in: bot.exchanges }, NOT: { apiKeyEnc: null } },
        select: { exchange: true },
      })
    : [];
  const connectedSet = new Set(conns.map((c) => c.exchange));
  const connectedByExchange: Record<string, boolean> = Object.fromEntries(
    bot.exchanges.map((e) => [e, connectedSet.has(e)]),
  );

  return (
    <AppShell>
      {/* top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/my-bots/${bot.id}`}
          className="inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-white"
        >
          <BackArrow />
          Back to Bot Details
        </Link>
      </div>

      {/* title */}
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">Bot Settings</h1>
        <p className="text-sm leading-[21px] text-muted">Control capital allocation and automation behavior.</p>
      </header>

      <BotSettingsForm
        botId={bot.id}
        exchanges={bot.exchanges}
        chosen={chosen}
        connectedByExchange={connectedByExchange}
        initial={{
          allocationType: userBot.allocationType,
          capitalPerTrade: userBot.capitalPerTrade,
          allocatedCapital: userBot.allocatedCapital,
          compounding: userBot.compounding,
        }}
      >
        {/* Performance Overview — this deployment's own realized results. */}
        <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
          <h2 className="mb-1 text-base font-semibold text-white">Performance Overview</h2>
          <p className="mb-5 text-xs text-muted">
            {closed.length
              ? `Realized across ${closed.length} closed trade${closed.length === 1 ? "" : "s"}.`
              : "No closed trades yet — these fill in from real fills."}
          </p>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <OverviewCard
              label="ROI on margin"
              value={closed.length ? `${roi >= 0 ? "+" : ""}${roi.toFixed(2)}%` : "—"}
              tone={closed.length ? (roi >= 0 ? "success" : "danger") : undefined}
              icon={<TrendIcon />}
            />
            <OverviewCard
              label="Realized PnL"
              value={closed.length ? `${realized >= 0 ? "+" : "-"}$${Math.abs(realized).toFixed(2)}` : "—"}
              tone={closed.length ? (realized >= 0 ? "success" : "danger") : undefined}
              icon={<BarIcon />}
            />
            <OverviewCard label="Risk Exposure" value={RISK_EXPOSURE[bot.riskClass]} icon={<ShieldIcon />} />
          </div>
          <AreaChart points={curve} />
        </section>
      </BotSettingsForm>
    </AppShell>
  );
}

function OverviewCard({
  label,
  value,
  tone = "default",
  icon,
}: {
  label: string;
  value: string;
  // Real results can lose money; the mock they replaced never could.
  tone?: "default" | "success" | "danger";
  icon: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-background p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-muted">{label}</span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">{icon}</span>
      </div>
      <span
        className={cn(
          "text-2xl font-semibold",
          tone === "success" ? "text-success" : tone === "danger" ? "text-[#D2031E]" : "text-white",
        )}
      >
        {value}
      </span>
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
function TrendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 17l6-6 4 4 8-8M21 7h-5M21 7v5" />
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
function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 4 6v6c0 5 3.5 7.5 8 9 4.5-1.5 8-4 8-9V6l-8-3Z" />
    </svg>
  );
}
