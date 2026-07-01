import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { MyBotsBrowser, type MyBotRow } from "@/components/my-bots/MyBotsBrowser";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";
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
  const userBots = await prisma.userBot.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      active: true,
      allocatedCapital: true,
      bot: { select: { id: true, name: true, exchange: true, riskClass: true, winRate: true, d360: true } },
    },
  });

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

  const rows: MyBotRow[] = userBots.map((ub) => ({
    botId: ub.bot.id,
    name: ub.bot.name,
    exchange: ub.bot.exchange,
    riskClass: ub.bot.riskClass,
    winRate: ub.bot.winRate,
    d360: ub.bot.d360,
    active: ub.active,
    allocatedCapital: ub.allocatedCapital,
  }));

  const activeRows = rows.filter((r) => r.active);
  const kpis = {
    totalActive: activeRows.length,
    totalCapital: activeRows.reduce((sum, r) => sum + r.allocatedCapital, 0),
    // Average win rate across active bots (real backtest figure); 0 when none active.
    avgWinRate: activeRows.length ? activeRows.reduce((sum, r) => sum + r.winRate, 0) / activeRows.length : 0,
  };

  return <MyBotsBrowser rows={rows} kpis={kpis} />;
}
