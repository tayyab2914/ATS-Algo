import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { isAdmin, isAdminEmail, toPublicUser } from "@/lib/auth/account";
import { verifyAdminCode } from "@/lib/auth/admin-code";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { adminCodeSchema } from "@/lib/validation";

/**
 * Verify the emailed admin code for the submitted address. On success, sign the
 * caller in as that admin and start a session. The configured ADMIN_EMAIL is
 * created on first use; an admin granted the role from Admin Management already
 * exists. Admin standing is re-checked here in case the role or account status
 * changed between requesting the code and using it.
 */
export async function POST(request: NextRequest) {
  const parsed = adminCodeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { email } = parsed.data; // schema lowercases/trims

  if (!(await verifyAdminCode(email, parsed.data.code))) {
    return fail("Invalid or expired code", 401);
  }

  if (!(await isAdmin(email))) {
    return fail("This account no longer has admin access.", 403);
  }

  const admin = isAdminEmail(email)
    ? await prisma.user.upsert({
        where: { email },
        update: { role: "ADMIN", emailVerified: new Date() },
        create: {
          email,
          passwordHash: await hashPassword(crypto.randomUUID()),
          role: "ADMIN",
          emailVerified: new Date(),
          name: "Administrator",
        },
      })
    : await prisma.user.findUniqueOrThrow({ where: { email } });

  // Admins are exempt from the user Rules & Policy gate.
  await createSession({
    sub: admin.id,
    email: admin.email,
    role: "ADMIN",
    emailVerified: true,
    policyAccepted: true,
  });

  return ok({ user: toPublicUser(admin) });
}
