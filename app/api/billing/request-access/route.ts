import { ok, fail } from "@/lib/api";
import { adminEmails } from "@/lib/auth/account";
import { getPageAccess } from "@/lib/auth/guards";
import { appBaseUrl } from "@/lib/app-url";
import { prisma } from "@/lib/db";
import { sendSubscriptionRequestEmail } from "@/lib/email";

/**
 * A member asks an admin for access. There is nothing to buy, so this is the
 * whole of the "subscribe" flow: record the ask, tell the admins, done.
 *
 * Deliberately gated on {@link getPageAccess} rather than `requireMember` — the
 * latter 403s every non-member, which is precisely the audience this route
 * exists for. A guest (trial running OR expired) must be able to reach it; a
 * suspended or banned account must not, and gets that for free because
 * `loadViewer` refuses to resolve a session for any non-ACTIVE user, so `session`
 * comes back null and the 401 below catches them.
 *
 * No request body, hence no schema: who is asking comes from the session, and
 * what they are asking for is the only thing on offer.
 */

/** One re-request per day once a previous one has been resolved. */
const REQUEST_COOLDOWN_MS = 1000 * 60 * 60 * 24;

export async function POST() {
  const { session, tier } = await getPageAccess();
  if (!session) return fail("Not authenticated", 401);

  // An admin row is refused every subscription action by /api/admin/members, so
  // a request from one could never be cleared from the inbox. Refuse it here
  // instead of creating a permanently stuck item.
  if (session.role === "ADMIN") return fail("Admin accounts already have full access.", 409);
  if (tier === "member") return fail("You already have access.", 409);

  const existing = await prisma.subscriptionRequest.findUnique({
    where: { userId: session.sub },
    select: { status: true, requestedAt: true },
  });

  // Already waiting on an admin: report success without sending a second email.
  // Clicking twice should feel like it worked, not like it failed or spammed.
  if (existing?.status === "PENDING") return ok({ ok: true, alreadyPending: true });

  // Resolved (approved-then-lapsed, or declined) — let them ask again, but not
  // on a loop. The single row means this one timestamp is the whole rate limit.
  if (existing && Date.now() - existing.requestedAt.getTime() < REQUEST_COOLDOWN_MS) {
    return fail("You've already sent a request recently. An admin will be in touch.", 429);
  }

  await prisma.subscriptionRequest.upsert({
    where: { userId: session.sub },
    create: { userId: session.sub },
    update: { status: "PENDING", requestedAt: new Date(), resolvedAt: null },
  });

  // Notify AFTER the row is committed, and never let it fail the request: a down
  // mailbox must cost the admins a notification, not the member their place in
  // the queue — the request is already visible in Members Management either way.
  try {
    const recipients = await adminEmails();
    if (recipients.length === 0) {
      console.warn("Subscription request: no admin address resolvable; notification skipped.");
    } else {
      const user = await prisma.user.findUnique({
        where: { id: session.sub },
        select: { name: true, email: true },
      });
      await sendSubscriptionRequestEmail(
        recipients.join(","),
        { name: user?.name ?? null, email: user?.email ?? session.email },
        `${appBaseUrl()}/admin/management`,
      );
    }
  } catch (error) {
    console.error("Subscription request notification failed:", error);
  }

  return ok({ ok: true });
}
