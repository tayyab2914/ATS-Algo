import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { BotMenu } from "@/components/admin/BotMenu";
import { BotsTable, type BotTableRow } from "@/components/admin/BotsTable";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Bot Management · ATS-ALGO",
};

export default async function BotManagementPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const bots = await prisma.bot.findMany({ orderBy: { createdAt: "desc" } });
  const rows: BotTableRow[] = bots.map((b) => ({
    id: b.id,
    name: b.name,
    timeframe: b.timeframe,
    riskClass: b.riskClass,
    status: b.status,
    trades: b.trades,
    winRate: b.winRate,
    profitFactor: b.profitFactor,
    d30: b.d30,
    d90: b.d90,
    d180: b.d180,
    d360: b.d360,
    avgTrade: b.avgTrade,
  }));

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="bots" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Bot Management</h1>
          <p className="text-sm leading-[21px] text-muted">Create, backtest, and manage trading bots.</p>
        </header>

        <BotMenu />
        <BotsTable bots={rows} />
      </main>
    </div>
  );
}
