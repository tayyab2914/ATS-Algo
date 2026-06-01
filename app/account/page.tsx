import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ExchangeSection } from "@/components/account/ExchangeSection";
import { ProfileSection } from "@/components/account/ProfileSection";
import { TradingViewSection } from "@/components/account/TradingViewSection";
import { WalletSection } from "@/components/account/WalletSection";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { Sidebar } from "@/components/dashboard/Sidebar";
import type { ExchangeName } from "@/lib/account";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Account Settings · Adrian Trading System",
};

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: { exchangeConnections: true },
  });
  if (!user) redirect("/login");

  const connections = Object.fromEntries(
    user.exchangeConnections.map((c) => [c.exchange, { permissions: c.permissions }]),
  ) as Partial<Record<ExchangeName, { permissions: string }>>;

  return (
    <div className="flex min-h-screen w-full bg-background text-white">
      <Sidebar active="settings" />

      <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold leading-[31px] text-white">Account Settings</h1>
            <p className="text-sm leading-[21px] text-muted">
              Manage your profile, connections, and exchange APIs.
            </p>
          </div>
          <LogoutButton />
        </header>

        <ProfileSection
          initial={{ username: user.name ?? "", email: user.email, avatarUrl: user.avatarUrl }}
        />
        <TradingViewSection initialConnected={user.tradingViewConnected} />
        <WalletSection initialConnected={user.walletConnected} initialAddress={user.walletAddress} />
        <ExchangeSection initial={connections} />
      </main>
    </div>
  );
}
