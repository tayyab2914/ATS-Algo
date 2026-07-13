import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { BotLibraryBrowser } from "@/components/bot-library/BotLibraryBrowser";
import { type BotTableRow } from "@/components/admin/BotsTable";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";
import { countFor, deploymentCounts } from "@/lib/bots/deployment-counts";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Bot Library · ATS-ALGO",
};

/**
 * Bot Library. Open to visitors and active guests (read-only browsing) as well
 * as members — it's the landing destination for the "Check out Bot Library" CTA,
 * and one of the three surfaces a Guest Mode trial may explore. Expired guests
 * are walled to Billing like every other tab.
 *
 * Shows the real catalogue: every ACTIVE bot from the admin, in the same table
 * the admin manages them with (minus the admin-only Status column / actions).
 */
export default async function BotLibraryPage() {
  const { tier } = await getPageAccess();
  blockExpiredGuest(tier);

  // Only the table columns — skips the heavy csvData/config/results blobs. Only
  // ACTIVE bots are public; disabled bots are hidden from members.
  const [bots, counts] = await Promise.all([
    prisma.bot.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      category: true,
      ticker: true,
      exchange: true,
      exchanges: true,
      timeframe: true,
      riskClass: true,
      status: true,
      trades: true,
      winRate: true,
      profitFactor: true,
      d30: true,
      d90: true,
      d180: true,
      d360: true,
      avgTrade: true,
      },
    }),
    deploymentCounts(),
  ]);

  // "Users" is how many members deployed the bot; "running" how many are trading it.
  const rows: BotTableRow[] = bots.map((bot) => ({ ...bot, ...countFor(counts, bot.id) }));

  // Tabs are the categories actually present, so there are no empty tabs.
  const categories = [...new Set(rows.map((r) => r.category))].sort((a, b) => a.localeCompare(b));

  return (
    <AppShell>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">Bot Library</h1>
        <p className="text-sm leading-[21px] text-muted">
          Browse automated trading bots available for deployment.
        </p>
      </header>

      <BotLibraryBrowser bots={rows} categories={categories} />
    </AppShell>
  );
}
