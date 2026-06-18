import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { BillingPlan, SubscriptionStatus } from "@/lib/generated/prisma/enums";
import { planForPriceId, stripe } from "@/lib/stripe";

/**
 * Billing domain helpers that bridge Stripe and our database.
 *
 * Stripe is the source of truth for subscription state; the `subscriptions`
 * table is a cache kept in sync exclusively through the webhook handler, so the
 * rest of the app can read entitlement from Postgres without round-tripping to
 * Stripe on every request.
 */

/** Stripe `subscription.status` → our enum. */
const STATUS_MAP: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
  incomplete: SubscriptionStatus.INCOMPLETE,
  incomplete_expired: SubscriptionStatus.INCOMPLETE_EXPIRED,
  trialing: SubscriptionStatus.TRIALING,
  active: SubscriptionStatus.ACTIVE,
  past_due: SubscriptionStatus.PAST_DUE,
  canceled: SubscriptionStatus.CANCELED,
  unpaid: SubscriptionStatus.UNPAID,
  paused: SubscriptionStatus.PAUSED,
};

/** Statuses that grant access to paid features. */
export function hasActiveSubscription(status: SubscriptionStatus): boolean {
  return status === SubscriptionStatus.ACTIVE || status === SubscriptionStatus.TRIALING;
}

/**
 * Authoritative "does this subscription grant access right now" check.
 *
 * Paid subscriptions follow their synced Stripe status. Comp grants have no
 * webhook to expire them, so we additionally honour their end date — a grant
 * past its `currentPeriodEnd` no longer counts even though its stored status is
 * still ACTIVE.
 */
export function isSubscriptionActive(
  sub: { status: SubscriptionStatus; isComp: boolean; currentPeriodEnd: Date | null } | null,
): boolean {
  if (!sub) return false;
  if (sub.isComp) {
    return (
      sub.status === SubscriptionStatus.ACTIVE &&
      (sub.currentPeriodEnd === null || sub.currentPeriodEnd > new Date())
    );
  }
  return hasActiveSubscription(sub.status);
}

/** Load the user's subscription and report whether it currently grants access. */
export async function userHasAccess(userId: string): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { status: true, isComp: true, currentPeriodEnd: true },
  });
  return isSubscriptionActive(sub);
}

/**
 * Return the user's Stripe customer id, creating the customer on first use and
 * persisting it. The user id is stored in the customer's metadata so webhook
 * events can always be traced back to a user even if our local row is missing.
 */
export async function getOrCreateStripeCustomer(user: {
  id: string;
  email: string;
  name: string | null;
  stripeCustomerId: string | null;
}): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe().customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

/** Coerce a Stripe expandable customer field to its id. */
function customerId(customer: Stripe.Subscription["customer"]): string {
  return typeof customer === "string" ? customer : customer.id;
}

/**
 * Resolve which user a Stripe subscription belongs to. Prefers the `userId` we
 * stamp into subscription metadata at checkout; falls back to matching the
 * Stripe customer id we stored on the user.
 */
async function resolveUserId(subscription: Stripe.Subscription): Promise<string | null> {
  const fromMetadata = subscription.metadata?.userId;
  if (fromMetadata) return fromMetadata;

  const user = await prisma.user.findUnique({
    where: { stripeCustomerId: customerId(subscription.customer) },
    select: { id: true },
  });
  return user?.id ?? null;
}

/**
 * Mirror a Stripe subscription into our database. Idempotent: every relevant
 * webhook (`created`, `updated`, `deleted`) calls this with the latest object,
 * and we upsert the single row keyed by user. Unknown users are logged and
 * skipped rather than throwing, so Stripe doesn't retry a non-recoverable event.
 */
export async function syncSubscriptionFromStripe(subscription: Stripe.Subscription): Promise<void> {
  const userId = await resolveUserId(subscription);
  if (!userId) {
    console.warn(`Stripe subscription ${subscription.id} has no resolvable user; skipping sync.`);
    return;
  }

  const item = subscription.items.data[0];
  const priceId = item?.price.id ?? "";
  // Prefer our env-mapped plan; fall back to the price's billing interval so a
  // legacy or mismatched price still records a sensible cadence.
  const plan =
    planForPriceId(priceId) ??
    (item?.price.recurring?.interval === "year" ? BillingPlan.YEARLY : BillingPlan.MONTHLY);

  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;

  const data = {
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    plan,
    status: STATUS_MAP[subscription.status],
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    // A real Stripe subscription supersedes any admin-granted comp access.
    isComp: false,
  };

  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
