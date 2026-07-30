import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { BillingSection, type SubscriptionView } from "@/components/billing/BillingSection";
import { isSubscriptionActive, reconcileSubscriptionFromStripe } from "@/lib/billing";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

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
  // Deliberately use getSession here, NOT getPageAccess. The self-heal reconcile
  // below may flip this user to active; getPageAccess is React-cached per request
  // and is also called by AppShell, so calling it BEFORE the reconcile would
  // freeze a stale "guest" view into the cache — AppShell would then render the
  // trial banner even though the plan is now active. getSession has an
  // independent cache, leaving AppShell's getPageAccess to evaluate fresh AFTER
  // the reconcile has written the row.
  const session = await getSession();

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

  let user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { stripeCustomerId: true, subscription: true },
  });

  // Self-heal a missing/stale row when the activation webhook never arrived.
  // Only fires for a user who has a Stripe customer yet no active access, so the
  // happy path (already synced by /api/billing/return after checkout) does no
  // extra work. This is what rescues someone who was charged but whose webhook
  // was dropped: their plan settles the next time they open Billing.
  let justActivated = false;
  if (user?.stripeCustomerId && !isSubscriptionActive(user.subscription)) {
    try {
      if (await reconcileSubscriptionFromStripe(user.stripeCustomerId)) {
        user = await prisma.user.findUnique({
          where: { id: session.sub },
          select: { stripeCustomerId: true, subscription: true },
        });
        // The reconcile flipped a previously-inactive user to active. The other
        // tabs may still be cached (locked) in this browser's Router Cache; flag
        // it so the client drops that cache once. Unlike the checkout path there
        // is no Route Handler here to call revalidatePath (it can't run during a
        // Server Component render), so the bust is delegated to the client.
        justActivated = isSubscriptionActive(user?.subscription ?? null);
      }
    } catch (error) {
      console.error("Billing page subscription reconcile failed:", error);
    }
  }

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
          justActivated={justActivated}
        />
      </Suspense>
    </AppShell>
  );
}
