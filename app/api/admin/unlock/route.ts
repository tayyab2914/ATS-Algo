import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { toPublicUser } from "@/lib/auth/account";
import { verifyAdminCode } from "@/lib/auth/admin-code";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { adminCodeSchema } from "@/lib/validation";

/**
 * Verify the emailed admin code. On success, sign the caller in as the
 * configured admin (creating the account on first use) and start a session.
 */
export async function POST(request: NextRequest) {
  const parsed = adminCodeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  if (!adminEmail) return fail("Admin access is not configured", 500);

  if (!(await verifyAdminCode(parsed.data.code))) {
    return fail("Invalid or expired code", 401);
  }

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: "ADMIN", emailVerified: new Date() },
    create: {
      email: adminEmail,
      passwordHash: await hashPassword(crypto.randomUUID()),
      role: "ADMIN",
      emailVerified: new Date(),
      name: "Administrator",
    },
  });

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
