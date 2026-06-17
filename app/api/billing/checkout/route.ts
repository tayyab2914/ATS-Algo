import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { appBaseUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth/session";
import { getOrCreateStripeCustomer, hasActiveSubscription } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { priceIdForPlan, stripe } from "@/lib/stripe";
import { checkoutSchema } from "@/lib/validation";

/**
 * Start a Stripe Checkout session for the chosen plan and return its hosted URL.
 * The client redirects the browser there; on completion Stripe sends the user
 * back to /billing and fires the webhooks that actually record the subscription.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, email: true, name: true, stripeCustomerId: true, subscription: true },
  });
  if (!user) return fail("Account not found", 404);

  // Don't let an already-subscribed user open a second checkout; send them to
  // the portal to change plans instead.
  if (user.subscription && hasActiveSubscription(user.subscription.status)) {
    return fail("You already have an active subscription. Manage it from the billing portal.", 409);
  }

  let url: string | null;
  try {
    const customer = await getOrCreateStripeCustomer(user);
    const base = appBaseUrl();
    const checkout = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price: priceIdForPlan(parsed.data.plan), quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: user.id,
      // Stamp the user id onto the subscription so webhook events resolve back
      // to an account without depending on a customer lookup.
      subscription_data: { metadata: { userId: user.id } },
      success_url: `${base}/billing?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/billing?status=cancelled`,
    });
    url = checkout.url;
  } catch (error) {
    console.error("Stripe checkout creation failed:", error);
    return fail("Could not start checkout. Please try again.", 502);
  }

  if (!url) return fail("Could not start checkout. Please try again.", 502);
  return ok({ url });
}
