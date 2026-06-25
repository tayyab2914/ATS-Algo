import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { cache } from "react";
import { fail } from "@/lib/api";
import { SESSION_COOKIE, verifyToken, type SessionPayload } from "@/lib/auth/jwt";
import { isSubscriptionActive } from "@/lib/billing";
import { prisma } from "@/lib/db";
import type { SubscriptionStatus } from "@/lib/generated/prisma/enums";
import { guestTrialFrom, type GuestTrial } from "@/lib/guest";

/** The subscription columns the entitlement check needs. */
type ViewerSubscription = { status: SubscriptionStatus; isComp: boolean; currentPeriodEnd: Date | null };

/**
 * Who is viewing a gated surface.
 *
 * - `visitor`      — signed out. Sees the "sign in to unlock" {@link GuestGate}.
 * - `guestActive`  — signed in, no active plan, trial still running. Read-only
 *                    access to the dashboard, bot library and bot profiles;
 *                    every other tab is locked behind an upgrade.
 * - `guestExpired` — signed in, no active plan, trial elapsed. Hard-walled to the
 *                    Billing tab — every other in-app route bounces there.
 * - `member`       — active paid plan or live comp grant. Full access.
 * - `admin`        — full access, never a guest.
 */
export type ViewerTier = "visitor" | "guestActive" | "guestExpired" | "member" | "admin";

/** The signed-in user's display fields for the sidebar profile footer. */
export type ViewerProfile = { name: string | null; email: string; avatarUrl: string | null };

export type PageAccess = {
  /** The signed-in session, or `null` for a visitor. */
  session: SessionPayload | null;
  /** The viewer's access tier. */
  tier: ViewerTier;
  /**
   * True when the viewer may use paid (write) features: a member or an admin.
   * Guests and visitors are always `false`. Kept as a convenience flag for the
   * many call sites that only care "full access yes/no".
   */
  entitled: boolean;
  /** Trial details when the viewer is a guest (`guestActive`/`guestExpired`); else null. */
  guest: GuestTrial | null;
  /** Profile fields for the signed-in user (null for a visitor) — saves AppShell a query. */
  profile: ViewerProfile | null;
};

/**
 * Single per-request load of the viewer's row.
 *
 * One DB round-trip fetches everything the gated render needs — liveness
 * (`status`/`sessionsValidFrom`), entitlement (`subscription`), the guest trial
 * clock (`guestExpiresAt`) and the sidebar profile fields — instead of the three
 * separate `user.findUnique` calls this used to make per navigation (getSession
 * liveness + getPageAccess subscription + AppShell profile). Wrapped in React
 * `cache` so the page and {@link AppShell} share the one query.
 *
 * Returns `null` for a visitor OR a revoked session (deleted, suspended/banned,
 * or force-logged-out), replicating {@link getSession}'s liveness gate exactly.
 */
const loadViewer = cache(
  async (): Promise<{
    session: SessionPayload;
    subscription: ViewerSubscription | null;
    guestExpiresAt: Date | null;
    profile: ViewerProfile;
  } | null> => {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const session = await verifyToken(token);
    if (!session) return null;

    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: {
        status: true,
        sessionsValidFrom: true,
        guestExpiresAt: true,
        name: true,
        email: true,
        avatarUrl: true,
        subscription: { select: { status: true, isComp: true, currentPeriodEnd: true } },
      },
    });
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
      guestExpiresAt: user.guestExpiresAt,
      profile: { name: user.name, email: user.email, avatarUrl: user.avatarUrl },
    };
  },
);

/**
 * Resolve a viewer's access for a subscription-gated page WITHOUT redirecting.
 *
 * Pages render in place based on this — visitors get their "sign in" lock,
 * active guests get the read-only experience with a trial banner, expired guests
 * are bounced to billing (see {@link blockExpiredGuest}), members/admins get the
 * real content. Avoiding a redirect for the common cases keeps tab switches
 * instant (no blank flash while a server redirect bounces around).
 *
 * Authoritative: subscription state is read from the database each request, so
 * access reflects webhook updates immediately rather than a stale JWT claim.
 *
 * Wrapped in React `cache` so the page and the surrounding {@link AppShell} (and
 * any other caller) share a single evaluation — and a single DB query — per request.
 */
export const getPageAccess = cache(async (): Promise<PageAccess> => {
  const viewer = await loadViewer();
  if (!viewer) {
    return { session: null, tier: "visitor", entitled: false, guest: null, profile: null };
  }

  const { session, subscription, guestExpiresAt, profile } = viewer;
  if (session.role === "ADMIN") {
    return { session, tier: "admin", entitled: true, guest: null, profile };
  }

  // A live paid plan or comp grant outranks the trial clock entirely.
  if (isSubscriptionActive(subscription)) {
    return { session, tier: "member", entitled: true, guest: null, profile };
  }

  const guest = guestTrialFrom(guestExpiresAt ?? null);
  return {
    session,
    tier: guest.expired ? "guestExpired" : "guestActive",
    entitled: false,
    guest,
    profile,
  };
});

/**
 * Hard paywall for expired guests: bounce every in-app route except Billing to
 * the Billing tab. Call near the top of a gated server component, passing the
 * tier from {@link getPageAccess}. A no-op for every other tier.
 */
export function blockExpiredGuest(tier: ViewerTier): void {
  if (tier === "guestExpired") redirect("/billing?expired=1");
}

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
        error: "Your guest trial is read-only. Become a member to make changes.",
        upgradeRequired: true,
      },
      { status: 403 },
    ),
  };
}
