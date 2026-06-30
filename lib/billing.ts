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

/**
 * Belt-and-suspenders activation for the moment a user returns from Checkout.
 *
 * Webhooks are authoritative but asynchronous — if one is delayed, mis-signed, or
 * never reaches this deployment, the user is charged yet sees no plan (and every
 * gated tab stays locked). So when they land back from Stripe with their checkout
 * `session_id`, we retrieve that session and sync its subscription immediately,
 * exactly as the webhook would. Idempotent with the webhook (both upsert the one
 * row keyed by user); whichever runs first wins and the other is a no-op.
 *
 * Scoped to the signed-in user: a session whose `client_reference_id` (stamped at
 * checkout) doesn't match is ignored, so one user can't activate off another's
 * checkout. Returns false when there is nothing to sync.
 */
export async function reconcileCheckoutSession(sessionId: string, userId: string): Promise<boolean> {
  const checkout = await stripe().checkout.sessions.retrieve(sessionId);
  if (checkout.client_reference_id && checkout.client_reference_id !== userId) return false;
  if (checkout.mode !== "subscription" || !checkout.subscription) return false;

  const subscriptionId =
    typeof checkout.subscription === "string" ? checkout.subscription : checkout.subscription.id;
  const subscription = await stripe().subscriptions.retrieve(subscriptionId);
  await syncSubscriptionFromStripe(subscription);
  return true;
}

/**
 * Self-healing fallback for a user whose cached subscription row is missing or
 * stale because the activation webhook was never delivered. Given their Stripe
 * customer, pull the latest subscription state straight from Stripe and sync it,
 * preferring one that currently grants access over a stale canceled/incomplete
 * one. This is what repairs an already-charged user who has since navigated away
 * from the post-checkout page (so has no `session_id` to reconcile against): the
 * next time they open Billing, their plan settles. No customer, or no
 * subscriptions on Stripe, means there is genuinely nothing to grant.
 */
export async function reconcileSubscriptionFromStripe(customerId: string): Promise<boolean> {
  const subs = await stripe().subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  if (subs.data.length === 0) return false;

  // Stripe returns newest first. Pick by entitlement priority, not just recency,
  // so an access-granting subscription always wins over a stale/dead one even if
  // a newer non-paying sub exists (e.g. an abandoned re-checkout left INCOMPLETE
  // after the real paid sub). Within a tier, the first (newest) is kept.
  const RANK: Record<string, number> = {
    active: 0,
    trialing: 1,
    past_due: 2,
    unpaid: 3,
    paused: 4,
    incomplete: 5,
    canceled: 6,
    incomplete_expired: 7,
  };
  const best = subs.data.reduce((a, b) =>
    (RANK[b.status] ?? 99) < (RANK[a.status] ?? 99) ? b : a,
  );
  await syncSubscriptionFromStripe(best);
  return true;
}
