import { fail, ok } from "@/lib/api";
import { resendEmailChangeCode } from "@/lib/auth/email-change";
import { requireMember } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

/** Re-issue the code for whichever step of the email change is active. */
export async function POST() {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { email: true },
  });
  if (!user) return fail("Account not found", 404);

  const result = await resendEmailChangeCode(session.sub, user.email);
  if (!result.ok) {
    switch (result.reason) {
      case "NONE":
        return fail("No email change in progress. Start again.", 404);
      case "EXPIRED":
        return fail("This request expired. Please start again.", 410);
      case "COOLDOWN":
        return fail("Please wait a few seconds before requesting another code.", 429);
      case "TAKEN":
        return fail("That email address was just taken. Please start again.", 409);
      case "SEND_FAILED":
        return fail("Couldn't send the code. Please try again.", 502);
    }
  }
  return ok({ stage: result.stage, sentTo: result.sentTo });
}
