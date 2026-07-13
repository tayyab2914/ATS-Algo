import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { MyBotsBrowser, type MyBotsKpis, type MyBotRow } from "@/components/my-bots/MyBotsBrowser";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";
import { profileFor, type BotConfig } from "@/lib/bot-config";
import { chosenExchange } from "@/lib/bot-exchanges";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "My Bots · ATS-ALGO",
};

export default async function MyBotsPage() {
  const { session, tier, entitled } = await getPageAccess();
  // Guests can't reach My Bots — expired ones go to Billing, active ones see the
  // members-only lock below.
  blockExpiredGuest(tier);

  return (
    <AppShell>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">My Bots</h1>
        <p className="text-sm leading-[21px] text-muted">
          Manage all trading bots you own, monitor performance, and control active strategies.
        </p>
      </header>

      {!session ? (
        <GuestGate title="My Bots" returnTo="/my-bots">
          <TabPreviewSkeleton />
        </GuestGate>
      ) : entitled ? (
        <MyBotsContent userId={session.sub} />
      ) : (
        <SubscriptionGate title="My Bots">
          <TabPreviewSkeleton />
        </SubscriptionGate>
      )}
    </AppShell>
  );
}

/** Loads the member's bots and either shows the dashboard or an empty-state CTA. */
async function MyBotsContent({ userId }: { userId: string }) {
  const [userBots, connections] = await Promise.all([
    prisma.userBot.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        active: true,
        allocatedCapital: true,
        allocationType: true,
        capitalPerTrade: true,
        exchangeSource: true,
        realizedBalance: true,
        bot: { select: { id: true, name: true, exchanges: true, riskClass: true, winRate: true, d360: true, config: true } },
        // Both OPEN (to show the live position on the row) and CLOSED (for realized
        // KPIs). At most one is OPEN — the engine's positionAlreadyOpen guard.
        positions: { select: { status: true, realizedPnl: true, tpRungsFilled: true, beMoved: true, side: true } },
      },
    }),
    // Exchanges the member has a usable (encrypted) key for — drives activation readiness.
    prisma.exchangeConnection.findMany({
      where: { userId, NOT: { apiKeyEnc: null } },
      select: { exchange: true },
    }),
  ]);
  const connectedExchanges = new Set(connections.map((c) => c.exchange));

  if (userBots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-line bg-surface px-6 py-20 text-center">
        <h2 className="text-lg font-semibold text-white">No bots yet</h2>
        <p className="max-w-sm text-sm leading-[21px] text-muted">
          Add your first bot from the library and it&apos;ll show up here, ready to activate.
        </p>
        <Link
          href="/bot-library"
          className="mt-1 inline-flex h-11 items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#06141a] transition-transform hover:-translate-y-0.5"
        >
          Browse Bot Library
        </Link>
      </div>
    );
  }

  const rows: MyBotRow[] = userBots.map((ub) => {
    const chosen = chosenExchange(ub.exchangeSource, ub.bot.exchanges);
    const openPos = ub.positions.find((p) => p.status === "OPEN") ?? null;
    const rungCount = profileFor(ub.bot.config as unknown as BotConfig, ub.bot.riskClass)?.tp.length ?? 0;
    return {
      botId: ub.bot.id,
      name: ub.bot.name,
      exchanges: ub.bot.exchanges,
      chosen,
      riskClass: ub.bot.riskClass,
      winRate: ub.bot.winRate,
      d360: ub.bot.d360,
      active: ub.active,
      allocatedCapital: ub.allocatedCapital,
      allocationType: ub.allocationType,
      capitalPerTrade: ub.capitalPerTrade,
      connected: chosen ? connectedExchanges.has(chosen) : false,
      // The live position on this deployment right now (or null when flat), plus the
      // realized total the reconcile job has booked — so the row shows real state.
      realizedBalance: ub.realizedBalance,
      rungCount,
      open: openPos ? { side: openPos.side, tpRungsFilled: openPos.tpRungsFilled, beMoved: openPos.beMoved } : null,
    };
  });

  // "Active" here means RUNNING — the member switched the deployment on. It is not
  // Bot.status, which only says the bot is published in the library.
  const activeRows = rows.filter((r) => r.active);

  // The member's own record, from trades the engine actually closed. Falling back
  // to the bots' backtested win rate is fine — but it must be labelled, never
  // passed off as this member's result.
  const closed = userBots.flatMap((ub) => ub.positions).filter((p) => p.status === "CLOSED");
  const wins = closed.filter((p) => p.realizedPnl > 0).length;
  const hasLive = closed.length > 0;

  const kpis: MyBotsKpis = {
    totalActive: activeRows.length,
    totalCapital: activeRows.reduce((sum, r) => sum + r.allocatedCapital, 0),
    realizedPnl: userBots.reduce((sum, ub) => sum + ub.realizedBalance, 0),
    closedTrades: closed.length,
    winRate: hasLive
      ? (wins / closed.length) * 100
      : activeRows.length
        ? activeRows.reduce((sum, r) => sum + r.winRate, 0) / activeRows.length
        : 0,
    winRateIsLive: hasLive,
  };

  return <MyBotsBrowser rows={rows} kpis={kpis} />;
}
