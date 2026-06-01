import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MyBotsPerformance } from "@/components/dashboard/MyBotsPerformance";
import { PerformanceMetrics } from "@/components/dashboard/PerformanceMetrics";
import { PortfolioAndHoldings } from "@/components/dashboard/PortfolioAndHoldings";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { TopActiveBots } from "@/components/dashboard/TopActiveBots";
import { TopAssets } from "@/components/dashboard/TopAssets";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Dashboard · Adrian Trading System",
};

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen w-full bg-background text-white">
      <Sidebar active="dashboard" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Dashboard Overview</h1>
          <p className="text-sm leading-[21px] text-muted">
            Monitor all trading bots, portfolio balance, and performance metrics.
          </p>
        </header>

        <PerformanceMetrics />
        <TopActiveBots />
        <MyBotsPerformance />
        <PortfolioAndHoldings />
        <TopAssets />
      </main>
    </div>
  );
}
