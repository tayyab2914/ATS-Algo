import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { startGuestTrialIfNeeded, toPublicUser } from "@/lib/auth/account";
import { createSession } from "@/lib/auth/session";
import {
  clearPendingTwoFactor,
  getPendingTwoFactor,
  verifyTwoFactorCode,
} from "@/lib/auth/two-factor";
import { prisma } from "@/lib/db";
import { twoFactorCodeSchema } from "@/lib/validation";

/**
 * Second step of 2FA login: verify the emailed code against the pending
 * challenge. On success, start the real session and clear the challenge.
 */
export async function POST(request: NextRequest) {
  const userId = await getPendingTwoFactor();
  if (!userId) return fail("Your verification session has expired. Please log in again.", 401);

  const parsed = twoFactorCodeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  if (!(await verifyTwoFactorCode(userId, parsed.data.code))) {
    return fail("Invalid or expired code", 401);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    await clearPendingTwoFactor();
    return fail("Account not found. Please log in again.", 401);
  }

  // Honour an account hold applied after the challenge was issued.
  if (user.status !== "ACTIVE") {
    await clearPendingTwoFactor();
    return fail("This account is not allowed to sign in. Contact support.", 403);
  }

  // First sign-in for a non-admin starts the 3-day Guest Mode trial clock.
  await startGuestTrialIfNeeded(user);

  await createSession({
    sub: user.id,
    email: user.email,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    emailVerified: user.emailVerified !== null,
    policyAccepted: user.policyAcceptedAt !== null,
  });
  await clearPendingTwoFactor();

  return ok({ user: toPublicUser(user) });
}
