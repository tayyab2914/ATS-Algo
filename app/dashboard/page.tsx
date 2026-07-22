import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { MyBotsPerformance } from "@/components/dashboard/MyBotsPerformance";
import { PerformanceMetrics } from "@/components/dashboard/PerformanceMetrics";
import { PortfolioAndHoldings } from "@/components/dashboard/PortfolioAndHoldings";
import { TopActiveBots } from "@/components/dashboard/TopActiveBots";
import { TopAssets } from "@/components/dashboard/TopAssets";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";
import { loadDashboard } from "@/lib/dashboard/metrics";
import { parsePeriod, parseTimeframe } from "@/lib/dashboard/window";

export const metadata: Metadata = {
  title: "Dashboard · ATS-ALGO",
};

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { session, tier } = await getPageAccess();
  // Expired guests are walled to Billing; visitors see the locked preview;
  // active guests and members alike see the (read-only) dashboard content.
  blockExpiredGuest(tier);

  const params = await searchParams;
  // Two controls, two windows. `p` picks a trailing period the catalogue can
  // actually express (30/90/180/360d); `tf` picks a calendar window over live
  // trades, where "today" and "this week" mean something.
  const period = parsePeriod(params.p);
  const timeframe = parseTimeframe(params.tf);

  // Every panel is this member's own. A visitor has no deployments, so the whole
  // screen falls back to the library's backtested figures — and the guest gate
  // blurs it regardless.
  const data = await loadDashboard(session?.sub ?? null, period, timeframe);

  const content = (
    <>
      <PerformanceMetrics data={data} />
      <TopActiveBots bots={data.topBots} running={data.topBotsAreRunning} deployed={data.hasDeployments} />
      <MyBotsPerformance bots={data.myBots} timeframe={data.timeframe} period={data.period} />
      <PortfolioAndHoldings data={data} />
      <TopAssets performers={data.topPerformers} />
    </>
  );

  return (
    <AppShell>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">Dashboard Overview</h1>
        <p className="text-sm leading-[21px] text-muted">
          Monitor your trading bots, portfolio balance, and performance metrics.
        </p>
      </header>

      {!session ? (
        <GuestGate title="Dashboard" returnTo="/dashboard">
          {content}
        </GuestGate>
      ) : (
        content
      )}
    </AppShell>
  );
}
