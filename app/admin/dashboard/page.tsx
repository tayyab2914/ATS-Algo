import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminOverview, type AdminOverviewData } from "@/components/admin/AdminOverview";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { BotMenu } from "@/components/admin/BotMenu";
import { getSession } from "@/lib/auth/session";
import { isSubscriptionActive } from "@/lib/billing";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Admin Dashboard · ATS-ALGO",
};

const DAY_MS = 86_400_000;
const shortDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
/** Cutoff `days` before now (kept out of the component body for lint purity). */
function cutoffDaysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

export default async function AdminDashboardPage() {
  const session = await getSession();
  if (!session) redirect("/admin");
  if (session.role !== "ADMIN") redirect("/dashboard");

  const thirtyDaysAgo = cutoffDaysAgo(30);

  const [
    totalBots,
    activeBots,
    users,
    subscribers,
    newSignups,
    byCategoryRaw,
    byRiskRaw,
    topBotsRaw,
    revisionsRaw,
    signupsRaw,
    canceledCount,
    pastDueCount,
    notRenewingCount,
    churnRaw,
  ] = await Promise.all([
    prisma.bot.count(),
    prisma.bot.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { role: "USER" } }),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { role: "USER", createdAt: { gte: thirtyDaysAgo } } }),
    prisma.bot.groupBy({ by: ["category"], _count: { _all: true } }),
    prisma.bot.groupBy({ by: ["riskClass"], _count: { _all: true } }),
    prisma.bot.findMany({
      orderBy: [{ profitFactor: "desc" }, { winRate: "desc" }],
      take: 5,
      select: { id: true, name: true, category: true, winRate: true, profitFactor: true, d30: true },
    }),
    prisma.botRevision.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { bot: { select: { id: true, name: true } } },
    }),
    prisma.user.findMany({
      where: { role: "USER" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        subscription: { select: { status: true, isComp: true, currentPeriodEnd: true } },
      },
    }),
    // Subscriptions that ended (cancelled / unpaid), are failing to renew
    // (past due), or are set to lapse at period end.
    prisma.subscription.count({ where: { status: { in: ["CANCELED", "INCOMPLETE_EXPIRED"] } } }),
    prisma.subscription.count({ where: { status: { in: ["PAST_DUE", "UNPAID"] } } }),
    prisma.subscription.count({ where: { status: "ACTIVE", cancelAtPeriodEnd: true } }),
    prisma.subscription.findMany({
      where: {
        OR: [
          { status: { in: ["CANCELED", "INCOMPLETE_EXPIRED", "PAST_DUE", "UNPAID"] } },
          { status: "ACTIVE", cancelAtPeriodEnd: true },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: true,
        user: { select: { name: true, email: true } },
      },
    }),
  ]);

  const data: AdminOverviewData = {
    activeBots,
    totalBots,
    users,
    subscribers,
    newSignups,
    byCategory: byCategoryRaw.map((c) => ({ name: c.category, count: c._count._all })).sort((a, b) => b.count - a.count),
    byRisk: (["LOW", "MEDIUM", "HIGH"] as const).map((risk) => ({
      risk,
      count: byRiskRaw.find((r) => r.riskClass === risk)?._count._all ?? 0,
    })),
    topBots: topBotsRaw,
    revisions: revisionsRaw.map((r) => ({
      id: r.id,
      botId: r.bot.id,
      botName: r.bot.name,
      message: r.message,
      date: shortDate(r.createdAt),
    })),
    signups: signupsRaw.map((u) => ({
      id: u.id,
      name: u.name || u.email,
      date: shortDate(u.createdAt),
      type: isSubscriptionActive(u.subscription) ? ("member" as const) : ("guest" as const),
    })),
    churn: {
      canceled: canceledCount,
      pastDue: pastDueCount,
      notRenewing: notRenewingCount,
      recent: churnRaw.map((s) => ({
        id: s.id,
        name: s.user.name?.trim() || s.user.email,
        email: s.user.email,
        // A still-active row in this list is one set to cancel at period end.
        status:
          s.status === "ACTIVE" && s.cancelAtPeriodEnd
            ? ("notRenewing" as const)
            : s.status === "PAST_DUE" || s.status === "UNPAID"
              ? ("pastDue" as const)
              : ("canceled" as const),
        date: s.currentPeriodEnd ? shortDate(s.currentPeriodEnd) : "—",
      })),
    },
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <AdminSidebar active="dashboard" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Admin Dashboard</h1>
          <p className="text-sm leading-[21px] text-muted">Platform overview — bots, members, and recent activity.</p>
        </header>

        <AdminOverview data={data} />
        <BotMenu />
      </main>
    </div>
  );
}
