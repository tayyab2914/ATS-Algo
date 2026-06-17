import { ok, fail } from "@/lib/api";
import { appBaseUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

/**
 * Open the Stripe-hosted Customer Portal where the user can update their payment
 * method, change plan, view invoices, or cancel. Returns the portal URL for the
 * client to redirect to. Requires an existing Stripe customer — i.e. the user
 * has been through checkout at least once.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { stripeCustomerId: true },
  });
  if (!user?.stripeCustomerId) {
    return fail("No billing account yet. Subscribe to a plan first.", 400);
  }

  try {
    const portal = await stripe().billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appBaseUrl()}/billing`,
    });
    return ok({ url: portal.url });
  } catch (error) {
    console.error("Stripe billing portal creation failed:", error);
    return fail("Could not open the billing portal. Please try again.", 502);
  }
}
