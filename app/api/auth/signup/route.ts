import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { isAdminEmail, issueVerificationEmail, toPublicUser } from "@/lib/auth/account";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { signupSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const parsed = signupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return fail("An account with this email already exists", 409);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: isAdminEmail(email) ? "ADMIN" : "USER",
    },
  });

  // Email verification is best-effort: a failed send must not lose the account.
  // The user is NOT signed in — they must verify their email, then log in.
  let emailSent = true;
  try {
    await issueVerificationEmail(user.id, user.email);
  } catch (error) {
    emailSent = false;
    console.error("Verification email failed:", error);
  }

  return ok({ user: toPublicUser(user), emailSent, requiresVerification: true }, 201);
}
