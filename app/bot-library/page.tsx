import { connection } from "next/server";
import { AppShell } from "@/components/app/AppShell";
import { BotLibraryBrowser } from "@/components/bot-library/BotLibraryBrowser";
import { GettingStarted } from "@/components/bot-library/GettingStarted";
import { type BotTableRow } from "@/components/admin/BotsTable";
import { countFor, deploymentCounts } from "@/lib/bots/deployment-counts";
import { prisma } from "@/lib/db";

/**
 * Bot Library. Open to everyone — visitors, read-only guests and members alike.
 * It is the landing destination for the "Check out Bot Library" CTA and the one
 * surface that has to sell the platform before anybody has an account, so it is
 * deliberately never gated; deploying is what needs membership, not browsing.
 *
 * Shows the real catalogue: every ACTIVE bot from the admin, in the same table
 * the admin manages them with (minus the admin-only Status column / actions).
 *
 * Rendered per request. Nothing else on this page reads a request-time API — the
 * entitlement check moved out when the tabs stopped being walled — so without the
 * `connection()` below Next would prerender it at BUILD time, which both freezes
 * the catalogue until the next deploy and makes the build itself depend on the
 * database being reachable. Neither is true of an admin-managed bot list.
 */
export default async function BotLibraryPage() {
  await connection();

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
      riskClass: true,
      status: true,
      trades: true,
      winRate: true,
      profitFactor: true,
      d30: true,
      d90: true,
      d180: true,
      d360: true,
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

      <GettingStarted />

      <BotLibraryBrowser bots={rows} categories={categories} />
    </AppShell>
  );
}
