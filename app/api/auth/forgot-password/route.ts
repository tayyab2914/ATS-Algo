import type { NextRequest } from "next/server";
import { ok, zodFail } from "@/lib/api";
import { createPasswordReset } from "@/lib/auth/password-reset";
import { prisma } from "@/lib/db";
import { forgotPasswordSchema } from "@/lib/validation";

/**
 * Begin a password reset. Always returns the same success response whether or
 * not the email exists, to avoid revealing which addresses are registered.
 */
export async function POST(request: NextRequest) {
  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user) {
    try {
      await createPasswordReset(user.id, user.email);
    } catch (error) {
      console.error("Password reset email failed:", error);
    }
  }

  return ok({ message: "If an account exists for that email, a reset link has been sent." });
}
