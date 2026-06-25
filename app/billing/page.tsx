import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { BillingSection, type SubscriptionView } from "@/components/billing/BillingSection";
import { isSubscriptionActive } from "@/lib/billing";
import { getPageAccess } from "@/lib/auth/guards";
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
  // getPageAccess is React-cached and also called by AppShell, so reusing it
  // here (rather than getSession) means the billing load shares one liveness
  // query instead of running its own on top of the shell's.
  const { session } = await getPageAccess();

  // Guests can browse the plans (picking one sends them to sign in first).
  if (!session) {
    return (
      <AppShell>
        <Header />
        <Suspense fallback={<TabPreviewSkeleton rows={3} />}>
          <BillingSection subscription={null} hasCustomer={false} authenticated={false} />
        </Suspense>
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
        <BillingSection
          subscription={subscription}
          hasCustomer={Boolean(user?.stripeCustomerId)}
          authenticated
        />
      </Suspense>
    </AppShell>
  );
}
