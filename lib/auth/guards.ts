import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { cache } from "react";
import { fail } from "@/lib/api";
import type { SessionPayload } from "@/lib/auth/jwt";
import { getSession } from "@/lib/auth/session";
import { isSubscriptionActive } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { guestTrialFrom, type GuestTrial } from "@/lib/guest";

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
};

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
 * any other caller) share a single evaluation per request.
 */
export const getPageAccess = cache(async (): Promise<PageAccess> => {
  const session = await getSession();
  if (!session) return { session: null, tier: "visitor", entitled: false, guest: null };
  if (session.role === "ADMIN") return { session, tier: "admin", entitled: true, guest: null };

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: {
      guestExpiresAt: true,
      subscription: { select: { status: true, isComp: true, currentPeriodEnd: true } },
    },
  });

  // A live paid plan or comp grant outranks the trial clock entirely.
  if (isSubscriptionActive(user?.subscription ?? null)) {
    return { session, tier: "member", entitled: true, guest: null };
  }

  const guest = guestTrialFrom(user?.guestExpiresAt ?? null);
  return {
    session,
    tier: guest.expired ? "guestExpired" : "guestActive",
    entitled: false,
    guest,
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
