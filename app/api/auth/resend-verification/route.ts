import type { NextRequest } from "next/server";
import { ok, zodFail } from "@/lib/api";
import { issueVerificationEmail } from "@/lib/auth/account";
import { prisma } from "@/lib/db";
import { forgotPasswordSchema } from "@/lib/validation";

/**
 * Re-send the account verification link. Only unverified accounts get a fresh
 * link; already-verified or unknown addresses are silently ignored. The
 * response is always the same so this can't be used to discover which emails
 * are registered or already confirmed (same privacy stance as forgot-password).
 */
export async function POST(request: NextRequest) {
  // Reuse the `{ email }` schema — same shape, same normalisation (trim/lowercase).
  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user && user.emailVerified === null) {
    try {
      await issueVerificationEmail(user.id, user.email);
    } catch (error) {
      console.error("Resend verification email failed:", error);
    }
  }

  return ok({ message: "If that email still needs verifying, a new link is on its way." });
}
