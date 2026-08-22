import { redirect } from "next/navigation";
import { AdminOverview, type AdminOverviewData } from "@/components/admin/AdminOverview";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { BotMenu } from "@/components/admin/BotMenu";
import { getSession } from "@/lib/auth/session";
import { isSubscriptionActive } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { describeEvent } from "@/lib/my-bots/live-view";

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

  const oneDayAgo = cutoffDaysAgo(1);

  const [
    totalBots,
    publishedBots,
    users,
    subscribers,
    newSignups,
    byCategoryRaw,
    byRiskRaw,
    topBotsRaw,
    revisionsRaw,
    signupsRaw,
    pendingRequestCount,
    pendingRequestsRaw,
    runningDeploymentsRaw,
    totalDeployments,
    openPositions,
    signals24h,
    failures24h,
    liveArmedCount,
    engineErrorsRaw,
  ] = await Promise.all([
    prisma.bot.count(),
    // Published = listed in the library. NOT the same as running: a member has to
    // deploy a bot and switch it on before it trades. See `runningDeployments`.
    prisma.bot.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { role: "USER" } }),
    // Members whose grant is LIVE right now. A lapsed grant leaves its row in
    // place — nothing rewrites it, the entitlement check just stops honouring it
    // — so the end-date predicate here has to mirror `isSubscriptionActive`
    // exactly, or this tile would count people who can no longer get in.
    prisma.subscription.count({
      where: { OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }] },
    }),
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
        subscription: { select: { currentPeriodEnd: true } },
      },
    }),
    // Members waiting on an access decision. With nothing to buy, this queue —
    // not churn — is the number that needs an operator to do something.
    //
    // The `role` filter matches the actionable queue on Members Management: an
    // ADMIN row is refused every subscription action, so counting one here would
    // show a warning tile the operator has no way to clear.
    prisma.subscriptionRequest.count({
      where: { status: "PENDING", user: { role: { not: "ADMIN" } } },
    }),
    prisma.subscriptionRequest.findMany({
      where: { status: "PENDING", user: { role: { not: "ADMIN" } } },
      orderBy: { requestedAt: "asc" },
      take: 5,
      select: {
        id: true,
        requestedAt: true,
        user: { select: { name: true, email: true } },
      },
    }),

    // ── Execution engine health. Nothing else in the admin panel can see this. ──
    prisma.userBot.findMany({ where: { active: true }, select: { botId: true }, distinct: ["botId"] }),
    prisma.userBot.count(),
    prisma.position.count({ where: { status: "OPEN" } }),
    prisma.signal.count({ where: { createdAt: { gte: oneDayAgo } } }),
    prisma.executionLog.count({ where: { level: "error", createdAt: { gte: oneDayAgo } } }),
    // Deployments armed to trade REAL money. The number an operator must know.
    prisma.userBot.count({ where: { liveArmed: true } }),
    prisma.executionLog.findMany({
      where: { level: { in: ["error", "warn"] } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, level: true, event: true, detail: true, createdAt: true },
    }),
  ]);

  const data: AdminOverviewData = {
    publishedBots,
    totalBots,
    engine: {
      runningBots: runningDeploymentsRaw.length,
      totalDeployments,
      openPositions,
      signals24h,
      failures24h,
      liveArmed: liveArmedCount,
      recent: engineErrorsRaw.map((log) => ({
        id: log.id,
        level: log.level,
        event: log.event,
        message: describeEvent(log.event, log.detail as Record<string, unknown> | null),
        at: shortDate(log.createdAt),
      })),
    },
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
    requests: {
      pending: pendingRequestCount,
      recent: pendingRequestsRaw.map((r) => ({
        id: r.id,
        name: r.user.name?.trim() || r.user.email,
        email: r.user.email,
        date: shortDate(r.requestedAt),
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
