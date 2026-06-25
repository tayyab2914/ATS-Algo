import type { NextRequest } from "next/server";
import { fail, ok, zodFail } from "@/lib/api";
import { confirmCurrentEmail } from "@/lib/auth/email-change";
import { requireMember } from "@/lib/auth/guards";
import { emailChangeCodeSchema } from "@/lib/validation";

/**
 * Stage 1: confirm the code emailed to the CURRENT address. On success a code is
 * sent to the new address and the flow advances to stage 2.
 */
export async function POST(request: NextRequest) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const parsed = emailChangeCodeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const result = await confirmCurrentEmail(session.sub, parsed.data.code);
  if (!result.ok) {
    switch (result.reason) {
      case "NONE":
        return fail("No email change in progress. Start again.", 404);
      case "EXPIRED":
        return fail("This request expired. Please start again.", 410);
      case "LOCKED":
        return fail("Too many incorrect codes. Please start again.", 429);
      case "INVALID":
        return fail("That code is incorrect. Check your email and try again.", 400);
      case "TAKEN":
        return fail("That email address was just taken. Please start again.", 409);
      case "SEND_FAILED":
        return fail("Couldn't send the code to your new address. Try resending.", 502);
    }
  }
  return ok({ stage: "new", sentTo: result.sentTo });
}
