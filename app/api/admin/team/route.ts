import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { hashPassword } from "@/lib/auth/password";
import { getSession } from "@/lib/auth/session";
import { appBaseUrl } from "@/lib/app-url";
import { prisma } from "@/lib/db";
import { sendTeamInviteEmail } from "@/lib/email";
import { adminSetRoleSchema } from "@/lib/validation";

/**
 * "Add Team Member" — invite someone by email and email them a tailored link:
 *
 *  - Admin invite: the account is created or promoted to ADMIN right away (so
 *    the passwordless admin code sign-in recognises them), and they're emailed
 *    a link to `/admin`.
 *  - Member invite: if they already have an account it's set to USER; either
 *    way they're emailed a link to `/signup` to create / use their account.
 *
 * Changing an existing account's role also invalidates its live sessions, since
 * the role is baked into the session JWT at login — forcing a re-login is what
 * makes the new role take effect.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const parsed = adminSetRoleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const { email, role } = parsed.data;

  if (email === session.email.toLowerCase()) {
    return fail("You can't invite yourself.", 409);
  }

  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, status: true },
  });

  if (role === "ADMIN") {
    if (existing) {
      // Only force a re-login when the role/standing actually changes, so a
      // simple re-invite doesn't sign an active admin out for nothing.
      const changed = existing.role !== "ADMIN" || existing.status !== "ACTIVE";
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: "ADMIN", status: "ACTIVE", ...(changed && { sessionsValidFrom: new Date() }) },
      });
    } else {
      // Create the account up front so the passwordless admin code sign-in
      // recognises them (it requires an existing ADMIN, ACTIVE user row).
      await prisma.user.create({
        data: {
          email,
          passwordHash: await hashPassword(crypto.randomUUID()),
          role: "ADMIN",
          status: "ACTIVE",
          emailVerified: new Date(),
        },
      });
    }
  } else if (existing && existing.role !== "USER") {
    // Demote a prior admin. New members register themselves via /signup, so a
    // not-yet-registered invitee needs no row created here.
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: "USER", sessionsValidFrom: new Date() },
    });
  }

  const base = appBaseUrl();
  const link = role === "ADMIN" ? `${base}/admin` : `${base}/signup`;
  try {
    await sendTeamInviteEmail(email, role, link);
  } catch (error) {
    console.error("Team invite email failed:", error);
    return fail("Couldn't send the invite email. Check email settings and try again.", 502);
  }

  return ok({ ok: true });
}
