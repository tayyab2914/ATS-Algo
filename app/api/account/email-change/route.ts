import type { NextRequest } from "next/server";
import { fail, ok, zodFail } from "@/lib/api";
import {
  cancelEmailChange,
  getPendingEmailChange,
  requestEmailChange,
} from "@/lib/auth/email-change";
import { requireMember } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { emailChangeStartSchema } from "@/lib/validation";

/** The signed-in user's current address, or null if the row vanished. */
async function currentEmailOf(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? null;
}

/** Resume support: report the pending email change (if any) for this user. */
export async function GET() {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const email = await currentEmailOf(session.sub);
  if (!email) return fail("Account not found", 404);

  const pending = await getPendingEmailChange(session.sub, email);
  return ok({ pending });
}

/** Start a change: validate, check availability, email a code to the CURRENT address. */
export async function POST(request: NextRequest) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const parsed = emailChangeStartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const email = await currentEmailOf(session.sub);
  if (!email) return fail("Account not found", 404);

  const result = await requestEmailChange(session.sub, email, parsed.data.email);
  if (!result.ok) {
    switch (result.reason) {
      case "SAME":
        return fail("That's already your email address.", 400);
      case "TAKEN":
        return fail("That email address is already in use.", 409);
      case "SEND_FAILED":
        return fail("Couldn't send the verification code. Please try again.", 502);
    }
  }
  return ok({ stage: "current", sentTo: result.sentTo });
}

/** Abandon a pending change. */
export async function DELETE() {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  await cancelEmailChange(session.sub);
  return ok({ cancelled: true });
}
