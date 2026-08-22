import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { TabPreviewSkeleton } from "@/components/app/TabPreviewSkeleton";
import { BillingSection, type SubscriptionView } from "@/components/billing/BillingSection";
import { getPageAccess } from "@/lib/auth/guards";
import { isSubscriptionActive } from "@/lib/billing";
import { prisma } from "@/lib/db";

function Header() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-2xl font-semibold leading-[31px] text-white">Billing</h1>
      <p className="text-sm leading-[21px] text-muted">
        Your access to ATS-ALGO, granted by an admin.
      </p>
    </header>
  );
}

export default async function BillingPage() {
  // getPageAccess is React-cached and shared with AppShell, which is only safe
  // because nothing on this page WRITES entitlement. If that ever changes, the
  // cached evaluation would freeze the pre-write ("guest") view and AppShell
  // would render the trial banner to someone who already has access.
  const { session } = await getPageAccess();

  // A signed-out visitor can still read what the page is for; requesting needs
  // an account, and the button prompts for one.
  if (!session) {
    return (
      <AppShell>
        <Header />
        <Suspense fallback={<TabPreviewSkeleton rows={3} />}>
          <BillingSection subscription={null} authenticated={false} requestPending={false} />
        </Suspense>
      </AppShell>
    );
  }

  const [sub, request] = await Promise.all([
    prisma.subscription.findUnique({
      where: { userId: session.sub },
      select: { currentPeriodEnd: true },
    }),
    prisma.subscriptionRequest.findUnique({
      where: { userId: session.sub },
      select: { status: true },
    }),
  ]);

  const active = isSubscriptionActive(sub);

  // The grant landed in ANOTHER browser — the admin's — so no revalidatePath
  // there could reach this member. An APPROVED request is the handshake that
  // says "you were just unlocked": consume it once here and let the client drop
  // its stale (locked) Router Cache for the other tabs. Same mechanism the old
  // post-checkout activation used, different trigger.
  let justActivated = false;
  if (active && request?.status === "APPROVED") {
    justActivated = true;
    await prisma.subscriptionRequest.deleteMany({ where: { userId: session.sub } });
  }

  const subscription: SubscriptionView | null = sub
    ? { active, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null }
    : null;

  return (
    <AppShell>
      <Header />
      <Suspense fallback={<TabPreviewSkeleton rows={3} />}>
        <BillingSection
          subscription={subscription}
          authenticated
          requestPending={request?.status === "PENDING"}
          justActivated={justActivated}
        />
      </Suspense>
    </AppShell>
  );
}
