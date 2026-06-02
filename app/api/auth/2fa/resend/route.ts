import { ok, fail } from "@/lib/api";
import { createAndSendTwoFactorCode, getPendingTwoFactor } from "@/lib/auth/two-factor";
import { prisma } from "@/lib/db";

/** Re-issue and re-send the 2FA login code for the current pending challenge. */
export async function POST() {
  const userId = await getPendingTwoFactor();
  if (!userId) return fail("Your verification session has expired. Please log in again.", 401);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return fail("Account not found. Please log in again.", 401);

  try {
    await createAndSendTwoFactorCode(user.id, user.email);
  } catch (error) {
    console.error("2FA code email failed:", error);
    return fail("Could not resend the code. Please try again.", 500);
  }
  return ok({ sent: true });
}
