import type { NextRequest } from "next/server";
import type Stripe from "stripe";
import { syncSubscriptionFromStripe } from "@/lib/billing";
import { stripe } from "@/lib/stripe";

/**
 * Stripe webhook receiver. This is the ONLY place subscription state is written
 * to our database, which keeps Stripe authoritative and avoids trusting the
 * client about what they paid for.
 *
 * Signature verification requires the exact raw request body, so we read it with
 * `request.text()` (never `request.json()`, which would reparse and break the
 * signature). Runs on the Node runtime; `constructEventAsync` uses Web Crypto so
 * it works without the synchronous Node crypto path.
 */
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set; rejecting webhook.");
    return new Response("Webhook not configured", { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(payload, signature, secret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error);
    return new Response("Invalid signature", { status: 400 });
  }

  try {
    switch (event.type) {
      // Fires when checkout finishes. We retrieve the subscription it created and
      // sync immediately so the user sees their plan the moment they return.
      case "checkout.session.completed": {
        const checkout = event.data.object;
        if (checkout.mode === "subscription" && checkout.subscription) {
          const subscriptionId =
            typeof checkout.subscription === "string"
              ? checkout.subscription
              : checkout.subscription.id;
          const subscription = await stripe().subscriptions.retrieve(subscriptionId);
          await syncSubscriptionFromStripe(subscription);
        }
        break;
      }

      // Covers new subscriptions, plan/quantity/status changes, renewals (which
      // move `current_period_end`), cancellations, and final deletion.
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscriptionFromStripe(event.data.object);
        break;
      }

      default:
        // Ignore the many event types we don't act on.
        break;
    }
  } catch (error) {
    // Return 500 so Stripe retries with backoff rather than dropping the event.
    console.error(`Error handling Stripe event ${event.type}:`, error);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
