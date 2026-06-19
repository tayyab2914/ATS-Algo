import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { ExchangeSection } from "@/components/account/ExchangeSection";
import { ProfileSection } from "@/components/account/ProfileSection";
import { TradingViewSection } from "@/components/account/TradingViewSection";
import { TwoFactorSection } from "@/components/account/TwoFactorSection";
import type { ExchangeName } from "@/lib/account";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Account Settings · ATS-ALGO",
};

export default async function AccountPage() {
  const session = await getSession();

  // Guests can reach the tab but see a locked preview rather than account data.
  if (!session) {
    return (
      <AppShell>
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold leading-[31px] text-white">Account Settings</h1>
          <p className="text-sm leading-[21px] text-muted">
            Manage your profile, connections, and exchange APIs.
          </p>
        </header>
        <GuestGate title="Account Settings" returnTo="/account">
          <TabPreviewSkeleton rows={4} />
        </GuestGate>
      </AppShell>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    include: { exchangeConnections: true },
  });
  if (!user) redirect("/login");

  const connections = Object.fromEntries(
    user.exchangeConnections.map((c) => [c.exchange, { permissions: c.permissions }]),
  ) as Partial<Record<ExchangeName, { permissions: string }>>;

  return (
    <AppShell>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold leading-[31px] text-white">Account Settings</h1>
        <p className="text-sm leading-[21px] text-muted">
          Manage your profile, connections, and exchange APIs.
        </p>
      </header>

      <ProfileSection
        initial={{ username: user.name ?? "", email: user.email, avatarUrl: user.avatarUrl }}
      />
      <TwoFactorSection initialEnabled={user.twoFactorEnabled} />
      <TradingViewSection initialConnected={user.tradingViewConnected} />
      <ExchangeSection initial={connections} />
    </AppShell>
  );
}
