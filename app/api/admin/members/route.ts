import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { isSuperAdminEmail } from "@/lib/auth/account";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { adminMemberActionSchema } from "@/lib/validation";

/**
 * Admin Management member actions. One POST handles every row action so the
 * client only has to talk to a single endpoint:
 *
 * - suspend / ban   — set account standing and kill any live session
 * - reactivate      — clear a suspension/ban
 * - forceLogout     — invalidate existing sessions without changing standing
 * - grantFree       — grant access for N months (0 = no expiry); also approves
 *                     any pending access request
 * - revokeFree      — end a granted access immediately
 * - declineRequest  — dismiss a pending access request without granting
 * - delete          — permanently remove the account (superadmin only)
 * - demote          — strip ADMIN back to USER (any admin, except self / superadmin)
 *
 * Admin accounts are off-limits to the standing/subscription actions so an admin
 * can't lock themselves (or a peer) out from here. The exceptions are `delete`
 * (superadmin only) and `demote` (any admin), both of which may target an admin.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const parsed = adminMemberActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const { memberId, action, durationMonths } = parsed.data;

  const member = await prisma.user.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      email: true,
      role: true,
      // Existence is the grant, so only the id is needed to know there is one.
      subscription: { select: { id: true } },
    },
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

  // Strip admin rights back to a regular member. Any admin may do this to a
  // peer, but never to themselves or to the superadmin. Bumping
  // `sessionsValidFrom` ends their live admin session so the demotion takes
  // effect on their next request rather than at token expiry.
  if (action === "demote") {
    if (member.role !== "ADMIN") return fail("This account is not an admin.", 409);
    if (member.id === session.sub) return fail("You can't remove your own admin access.", 409);
    if (isSuperAdminEmail(member.email)) return fail("The superadmin's access can't be removed.", 403);
    await prisma.user.update({
      where: { id: member.id },
      data: { role: "USER", sessionsValidFrom: new Date() },
    });
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
      // Re-granting REPLACES the end date rather than adding to it — the admin
      // picks the window they want from now, which is what the menu's wording
      // ("Grant access for…") promises.
      const months = durationMonths ?? 0;
      const periodEnd =
        months > 0 ? new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000) : null;
      const data = { currentPeriodEnd: periodEnd };
      // One transaction so a granted member can never be left still showing as
      // "pending" in the requests card — the two writes land together or not at
      // all. `updateMany` (not `update`) because most grants have no request
      // behind them at all, and a missing row must not throw.
      await prisma.$transaction([
        prisma.subscription.upsert({
          where: { userId: member.id },
          create: { userId: member.id, ...data },
          update: data,
        }),
        prisma.subscriptionRequest.updateMany({
          where: { userId: member.id, status: "PENDING" },
          data: { status: "APPROVED", resolvedAt: new Date() },
        }),
      ]);
      return ok({ ok: true });
    }

    case "revokeFree": {
      if (!member.subscription) {
        return fail("This member has no access to revoke", 409);
      }
      // `deleteMany`, not `delete`: two admins revoking at once would otherwise
      // race, and the loser's `delete` on an already-gone row throws P2025 → 500.
      await prisma.$transaction([
        prisma.subscription.deleteMany({ where: { userId: member.id } }),
        // Revoking access must also disarm real-money trading. `liveArmed` is a
        // deliberate opt-in for a LIVE key (see UserBot.liveArmed) and the whole
        // point of revoking is that this person is no longer entitled to run —
        // leaving it set would keep their bots opening real positions behind a
        // locked UI they can no longer reach. Open positions are untouched: the
        // reconcile job keeps managing their stops and take-profits to the exit.
        prisma.userBot.updateMany({
          where: { userId: member.id, liveArmed: true },
          data: { liveArmed: false },
        }),
      ]);
      return ok({ ok: true });
    }

    case "declineRequest": {
      const { count } = await prisma.subscriptionRequest.updateMany({
        where: { userId: member.id, status: "PENDING" },
        data: { status: "DECLINED", resolvedAt: new Date() },
      });
      if (count === 0) return fail("This member has no pending access request", 409);
      return ok({ ok: true });
    }

    default:
      return fail("Unknown action", 400);
  }
}
