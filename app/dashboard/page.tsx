import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { MyBotsPerformance } from "@/components/dashboard/MyBotsPerformance";
import { PerformanceMetrics } from "@/components/dashboard/PerformanceMetrics";
import { PortfolioAndHoldings } from "@/components/dashboard/PortfolioAndHoldings";
import { TopActiveBots } from "@/components/dashboard/TopActiveBots";
import { TopAssets } from "@/components/dashboard/TopAssets";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Dashboard · Adrian Trading System",
};

export default async function DashboardPage() {
  const session = await getSession();

  const content = (
    <>
      <PerformanceMetrics />
      <TopActiveBots />
      <MyBotsPerformance />
      <PortfolioAndHoldings />
      <TopAssets />
    </>
  );

  return (
    <AppShell>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">Dashboard Overview</h1>
        <p className="text-sm leading-[21px] text-muted">
          Monitor all trading bots, portfolio balance, and performance metrics.
        </p>
      </header>

      {session ? (
        content
      ) : (
        <GuestGate title="Dashboard" returnTo="/dashboard">
          {content}
        </GuestGate>
      )}
    </AppShell>
  );
}
