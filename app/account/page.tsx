import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { ExchangeSection } from "@/components/account/ExchangeSection";
import { ProfileSection } from "@/components/account/ProfileSection";
import { TradingViewSection } from "@/components/account/TradingViewSection";
import { TwoFactorSection } from "@/components/account/TwoFactorSection";
import type { ExchangeName } from "@/lib/account";
import { blockExpiredGuest, getPageAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Account Settings · ATS-ALGO",
};

function AccountHeader() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold leading-[31px] text-white">Account Settings</h1>
      <p className="text-sm leading-[21px] text-muted">
        Manage your profile, connections, and exchange APIs.
      </p>
    </header>
  );
}

export default async function AccountPage() {
  const { session, tier, entitled } = await getPageAccess();
  // Account settings are members-only: expired guests go to Billing, active
  // guests see the upgrade lock, visitors see the sign-in lock.
  blockExpiredGuest(tier);

  if (!session) {
    return (
      <AppShell>
        <AccountHeader />
        <GuestGate title="Account Settings" returnTo="/account">
          <TabPreviewSkeleton rows={4} />
        </GuestGate>
      </AppShell>
    );
  }

  if (!entitled) {
    return (
      <AppShell>
        <AccountHeader />
        <SubscriptionGate title="Account Settings">
          <TabPreviewSkeleton rows={4} />
        </SubscriptionGate>
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
