import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cache } from "react";
import { fail } from "@/lib/api";
import { SESSION_COOKIE, verifyToken, type SessionPayload } from "@/lib/auth/jwt";
import { isSubscriptionActive } from "@/lib/billing";
import { prisma } from "@/lib/db";

/** The subscription columns the entitlement check needs. */
type ViewerSubscription = { currentPeriodEnd: Date | null };

/**
 * Who is viewing a gated surface.
 *
 * - `visitor` — signed out. Sees the "sign in to unlock" {@link GuestGate}.
 * - `guest`   — signed in, no access grant. Read-only: they may explore the
 *               dashboard, bot library and bot profiles, but cannot deploy or
 *               run anything. This is where an INDIVIDUAL sign-up now lands and
 *               stays, indefinitely, until an admin makes them a member.
 * - `member`  — holds a live access grant: either granted by an admin from
 *               Members Management, or granted automatically at registration
 *               because they came through a Community Access Link.
 * - `admin`   — full access, never a guest.
 *
 * There is no expiring trial. The platform is sold to COMMUNITIES, so the way in
 * is an invite link that grants access on the spot; an individual who finds the
 * site keeps read-only access for as long as they like, which costs nothing and
 * keeps their address on file. A countdown would only pressure the one audience
 * the platform is not trying to convert.
 */
export type ViewerTier = "visitor" | "guest" | "member" | "admin";

/** The signed-in user's display fields for the sidebar profile footer. */
export type ViewerProfile = { name: string | null; email: string; avatarUrl: string | null };

export type PageAccess = {
  /** The signed-in session, or `null` for a visitor. */
  session: SessionPayload | null;
  /** The viewer's access tier. */
  tier: ViewerTier;
  /**
   * True when the viewer may use write features: a member or an admin. Guests
   * and visitors are always `false`. Kept as a convenience flag for the many call
   * sites that only care "full access yes/no".
   */
  entitled: boolean;
  /** Profile fields for the signed-in user (null for a visitor) — saves AppShell a query. */
  profile: ViewerProfile | null;
};

/**
 * Single per-request load of the viewer's row.
 *
 * One DB round-trip fetches everything the gated render needs — liveness
 * (`status`/`sessionsValidFrom`), entitlement (`subscription`) and the sidebar
 * profile fields — instead of the separate `user.findUnique` calls this used to
 * make per navigation (getSession liveness + getPageAccess subscription +
 * AppShell profile). Wrapped in React `cache` so the page and {@link AppShell}
 * share the one query.
 *
 * Returns `null` for a visitor OR a revoked session (deleted, suspended/banned,
 * or force-logged-out), replicating {@link getSession}'s liveness gate exactly.
 */
const loadViewer = cache(
  async (): Promise<{
    session: SessionPayload;
    subscription: ViewerSubscription | null;
    profile: ViewerProfile;
  } | null> => {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const session = await verifyToken(token);
    if (!session) return null;

    let user;
    try {
      user = await prisma.user.findUnique({
        where: { id: session.sub },
        select: {
          status: true,
          sessionsValidFrom: true,
          name: true,
          email: true,
          avatarUrl: true,
          subscription: { select: { currentPeriodEnd: true } },
        },
      });
    } catch (error) {
      // DB unreachable → we can't confirm liveness/entitlement. Fail CLOSED to a
      // visitor (same as a revoked session) so a transient blip renders the
      // signed-out gate instead of 500-ing the gated page and its AppShell. Mirrors
      // isSessionLive in lib/auth/session.ts; self-heals next request. Logged.
      console.error("loadViewer: viewer query failed — failing closed to visitor", error);
      return null;
    }
    if (!user) return null;

    // Authoritative liveness gate — identical to lib/auth/session.ts isSessionLive.
    if (user.status !== "ACTIVE") return null;
    if (
      user.sessionsValidFrom &&
      session.iat != null &&
      session.iat * 1000 < user.sessionsValidFrom.getTime()
    ) {
      return null;
    }

    return {
      session,
      subscription: user.subscription,
      profile: { name: user.name, email: user.email, avatarUrl: user.avatarUrl },
    };
  },
);

/**
 * Resolve a viewer's access for a gated page WITHOUT redirecting.
 *
 * Pages render in place based on this — visitors get their "sign in" lock, guests
 * get the read-only experience, members/admins get the real content. Nobody is
 * ever bounced to another tab, which keeps tab switches instant (no blank flash
 * while a server redirect bounces around).
 *
 * Authoritative: subscription state is read from the database each request, so an
 * admin's grant or revoke — and a grant simply reaching its end date — takes
 * effect on the member's very next request, not at token expiry.
 *
 * Wrapped in React `cache` so the page and the surrounding {@link AppShell} (and
 * any other caller) share a single evaluation — and a single DB query — per request.
 */
export const getPageAccess = cache(async (): Promise<PageAccess> => {
  const viewer = await loadViewer();
  if (!viewer) {
    return { session: null, tier: "visitor", entitled: false, profile: null };
  }

  const { session, subscription, profile } = viewer;
  if (session.role === "ADMIN") {
    return { session, tier: "admin", entitled: true, profile };
  }

  if (isSubscriptionActive(subscription)) {
    return { session, tier: "member", entitled: true, profile };
  }

  return { session, tier: "guest", entitled: false, profile };
});

/**
 * Mutation-route guard: allow only members and admins to write. Returns the
 * session on success, or a ready-to-return error Response:
 *  - 401 when signed out,
 *  - 403 (`upgradeRequired: true`) for a guest, whose access is read-only.
 *
 * Usage:
 *   const access = await requireMember();
 *   if ("error" in access) return access.error;
 *   const { session } = access;
 */
export async function requireMember(): Promise<
  { session: SessionPayload } | { error: Response }
> {
  const { session, tier } = await getPageAccess();
  if (!session) return { error: fail("Not authenticated", 401) };
  if (tier === "member" || tier === "admin") return { session };
  return {
    error: NextResponse.json(
      {
        error:
          "Your account has read-only guest access. Join through a community invite link, or ask an admin to enable bot access.",
        upgradeRequired: true,
      },
      { status: 403 },
    ),
  };
}
