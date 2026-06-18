import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { GuestGate } from "@/components/app/GuestGate";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { BillingSection, type SubscriptionView } from "@/components/billing/BillingSection";
import { isSubscriptionActive } from "@/lib/billing";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Billing · ATS-ALGO",
};

function Header() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold leading-[31px] text-white">Billing</h1>
      <p className="text-sm leading-[21px] text-muted">
        Manage your subscription, payment method, and invoices.
      </p>
    </header>
  );
}

export default async function BillingPage() {
  const session = await getSession();

  // Guests see the locked preview, consistent with the other in-app tabs.
  if (!session) {
    return (
      <AppShell>
        <Header />
        <GuestGate title="Billing" returnTo="/billing">
          <TabPreviewSkeleton rows={3} />
        </GuestGate>
      </AppShell>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { stripeCustomerId: true, subscription: true },
  });

  const sub = user?.subscription ?? null;
  const subscription: SubscriptionView | null = sub
    ? {
        plan: sub.plan,
        status: sub.status,
        active: isSubscriptionActive(sub),
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        isComp: sub.isComp,
      }
    : null;

  return (
    <AppShell>
      <Header />
      <Suspense fallback={<TabPreviewSkeleton rows={3} />}>
        <BillingSection subscription={subscription} hasCustomer={Boolean(user?.stripeCustomerId)} />
      </Suspense>
    </AppShell>
  );
}
