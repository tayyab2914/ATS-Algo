import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { MyBotsPerformance } from "@/components/dashboard/MyBotsPerformance";
import { PerformanceMetrics } from "@/components/dashboard/PerformanceMetrics";
import { PortfolioAndHoldings } from "@/components/dashboard/PortfolioAndHoldings";
import { TopActiveBots } from "@/components/dashboard/TopActiveBots";
import { TopAssets } from "@/components/dashboard/TopAssets";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";

export const metadata: Metadata = {
  title: "Dashboard · ATS-ALGO",
};

export default async function DashboardPage() {
  const { session, tier } = await getPageAccess();
  // Expired guests are walled to Billing; visitors see the locked preview;
  // active guests and members alike see the (read-only) dashboard content.
  blockExpiredGuest(tier);

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
