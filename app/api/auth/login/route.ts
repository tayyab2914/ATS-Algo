import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { toPublicUser } from "@/lib/auth/account";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { createAndSendTwoFactorCode, startPendingTwoFactor } from "@/lib/auth/two-factor";
import { prisma } from "@/lib/db";
import { loginSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // Same response whether the user is missing or the password is wrong, to
  // avoid leaking which emails are registered.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return fail("Invalid email or password", 401);
  }

  // Account standing gate (set from Admin Management). A banned or suspended
  // user can authenticate but is not allowed to start a session.
  if (user.status === "BANNED") {
    return fail("This account has been banned. Contact support if you believe this is a mistake.", 403);
  }
  if (user.status === "SUSPENDED") {
    return fail("This account is suspended. Contact support to restore access.", 403);
  }

  // Block sign-in until the email address is confirmed.
  if (user.emailVerified === null) {
    return fail("Please verify your email before logging in. Check your inbox for the confirmation link.", 403);
  }

  // Second factor: email a one-time code and hold a pending challenge instead
  // of starting a session. The session is only created once the code is verified.
  if (user.twoFactorEnabled) {
    try {
      await createAndSendTwoFactorCode(user.id, user.email);
    } catch (error) {
      console.error("2FA code email failed:", error);
      return fail("Could not send your verification code. Please try again.", 500);
    }
    await startPendingTwoFactor(user.id);
    return ok({ twoFactorRequired: true });
  }

  await createSession({
    sub: user.id,
    email: user.email,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    emailVerified: user.emailVerified !== null,
    policyAccepted: user.policyAcceptedAt !== null,
  });

  return ok({ user: toPublicUser(user) });
}
