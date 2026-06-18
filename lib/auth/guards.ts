import { redirect } from "next/navigation";
import type { SessionPayload } from "@/lib/auth/jwt";
import { getSession } from "@/lib/auth/session";
import { userHasAccess } from "@/lib/billing";

/**
 * Page guard for subscription-gated routes (Dashboard, Portfolio, My Bots).
 *
 * - Guest (no session) → returns `null`; the page renders its locked "sign in"
 *   preview, exactly as before.
 * - Admin → always allowed; running the platform never requires a subscription.
 * - Signed-in user without active access → redirected to /billing to subscribe.
 * - Entitled user (active paid plan or a live comp grant) → returns the session
 *   so the page renders its real content.
 *
 * Authoritative: reads subscription state from the database on each request, so
 * access reflects webhook updates immediately (no stale JWT claim).
 */
export async function requireSubscription(): Promise<SessionPayload | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "ADMIN" && !(await userHasAccess(session.sub))) {
    redirect("/billing?gated=1");
  }
  return session;
}
