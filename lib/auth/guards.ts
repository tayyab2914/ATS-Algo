import type { SessionPayload } from "@/lib/auth/jwt";
import { getSession } from "@/lib/auth/session";
import { userHasAccess } from "@/lib/billing";

export type PageAccess = {
  /** The signed-in session, or `null` for a guest. */
  session: SessionPayload | null;
  /**
   * True when the viewer may use paid features: a signed-in user with an active
   * paid plan or a live comp grant, or any admin. Guests are always `false`.
   */
  entitled: boolean;
};

/**
 * Resolve a viewer's access for a subscription-gated page WITHOUT redirecting.
 *
 * Pages render in place based on this — guests get their "sign in" lock, unpaid
 * users get a "subscribe" lock over a blurred preview, entitled users get the
 * real content. Avoiding a redirect keeps tab switches instant (no blank flash
 * while a server redirect bounces the user to /billing).
 *
 * Authoritative: subscription state is read from the database each request, so
 * access reflects webhook updates immediately rather than a stale JWT claim.
 */
export async function getPageAccess(): Promise<PageAccess> {
  const session = await getSession();
  if (!session) return { session: null, entitled: false };
  if (session.role === "ADMIN") return { session, entitled: true };
  return { session, entitled: await userHasAccess(session.sub) };
}
