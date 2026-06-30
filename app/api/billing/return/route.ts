import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { reconcileCheckoutSession } from "@/lib/billing";

/**
 * Post-checkout return URL. Stripe sends the user here with their `session_id`
 * the instant payment completes. We sync the subscription from Stripe BEFORE
 * handing off to /billing, so the plan is already active when that page — and the
 * surrounding shell, and every other gated tab — renders, instead of depending on
 * the webhook having already raced ahead. The webhook still runs and is
 * idempotent with this; whichever lands first wins, the other is a no-op.
 *
 * Runs on Node (Prisma) and must never be cached — it reads the session cookie
 * and writes the database on every hit.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  const session = await getSession();

  // Reconcile only for a signed-in user carrying a real checkout session id. Any
  // Stripe hiccup here is non-fatal: fall through to /billing, where the success
  // banner still shows and the webhook (or a later visit) settles the state.
  if (session && sessionId) {
    try {
      await reconcileCheckoutSession(sessionId, session.sub);
      // Activation changes entitlement for EVERY tab. The gated pages read the
      // subscription fresh per request, but the browser's Router Cache still
      // holds the pre-payment (locked / guest-banner) render of any tab visited
      // earlier. Purging the whole client cache here means the next visit to
      // Dashboard / Portfolio / My Bots / Account re-renders unlocked instead of
      // replaying the stale cached payload.
      revalidatePath("/", "layout");
    } catch (error) {
      console.error("Post-checkout reconcile failed:", error);
    }
  }

  return NextResponse.redirect(new URL("/billing?status=success", request.url), 303);
}
