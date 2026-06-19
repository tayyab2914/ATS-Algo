import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { isSuperAdminEmail } from "@/lib/auth/account";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { BillingPlan, SubscriptionStatus } from "@/lib/generated/prisma/enums";
import { adminMemberActionSchema } from "@/lib/validation";

/**
 * Admin Management member actions. One POST handles every row action so the
 * client only has to talk to a single endpoint:
 *
 * - suspend / ban   — set account standing and kill any live session
 * - reactivate      — clear a suspension/ban
 * - forceLogout     — invalidate existing sessions without changing standing
 * - grantFree       — give the member a free (comp) subscription, no Stripe
 * - revokeFree      — remove a previously granted comp subscription
 * - delete          — permanently remove the account (superadmin only)
 *
 * Admin accounts are off-limits to the standing/subscription actions so an admin
 * can't lock themselves (or a peer) out from here. The one exception is `delete`,
 * which the superadmin may use on members *and* admins.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const parsed = adminMemberActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const { memberId, action, durationMonths } = parsed.data;

  const member = await prisma.user.findUnique({
    where: { id: memberId },
    select: { id: true, email: true, role: true, subscription: { select: { isComp: true } } },
  });
  if (!member) return fail("Member not found", 404);

  // Permanent deletion is reserved for the superadmin and is the only action
  // allowed to target an admin account.
  if (action === "delete") {
    if (!isSuperAdminEmail(session.email)) {
      return fail("Only the superadmin can delete accounts", 403);
    }
    if (member.id === session.sub) {
      return fail("You can't delete your own account", 409);
    }
    // Relations (subscription, tokens, connections) cascade on user delete;
    // admin sign-in codes are keyed by email, not a relation, so clear them too.
    await prisma.adminLoginCode.deleteMany({ where: { email: member.email } });
    await prisma.user.delete({ where: { id: member.id } });
    return ok({ ok: true });
  }

  if (member.role === "ADMIN") return fail("Admin accounts can't be managed here", 403);

  switch (action) {
    case "suspend":
    case "ban": {
      // Changing standing also invalidates live sessions, so the hold takes
      // effect on the member's very next request rather than at token expiry.
      await prisma.user.update({
        where: { id: member.id },
        data: {
          status: action === "ban" ? "BANNED" : "SUSPENDED",
          sessionsValidFrom: new Date(),
        },
      });
      return ok({ ok: true });
    }

    case "reactivate": {
      await prisma.user.update({ where: { id: member.id }, data: { status: "ACTIVE" } });
      return ok({ ok: true });
    }

    case "forceLogout": {
      await prisma.user.update({
        where: { id: member.id },
        data: { sessionsValidFrom: new Date() },
      });
      return ok({ ok: true });
    }

    case "grantFree": {
      // Don't clobber a real Stripe subscription (Stripe would keep billing
      // while our cache claimed the access was free).
      if (member.subscription && !member.subscription.isComp) {
        return fail("This member already has a paid subscription", 409);
      }
      const months = durationMonths ?? 0;
      const periodEnd =
        months > 0 ? new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000) : null;
      const data = {
        stripeSubscriptionId: null,
        stripePriceId: null,
        plan: months >= 12 ? BillingPlan.YEARLY : BillingPlan.MONTHLY,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        isComp: true,
      };
      await prisma.subscription.upsert({
        where: { userId: member.id },
        create: { userId: member.id, ...data },
        update: data,
      });
      return ok({ ok: true });
    }

    case "revokeFree": {
      if (!member.subscription?.isComp) {
        return fail("This member has no granted subscription to revoke", 409);
      }
      await prisma.subscription.delete({ where: { userId: member.id } });
      return ok({ ok: true });
    }

    default:
      return fail("Unknown action", 400);
  }
}
