import type { NextRequest } from "next/server";
import { fail, ok, zodFail } from "@/lib/api";
import { toPublicUser } from "@/lib/auth/account";
import { confirmNewEmail } from "@/lib/auth/email-change";
import { requireMember } from "@/lib/auth/guards";
import { createSession } from "@/lib/auth/session";
import { stripe } from "@/lib/stripe";
import { emailChangeCodeSchema } from "@/lib/validation";

/**
 * Stage 2: confirm the code emailed to the NEW address, then commit the change.
 * The session cookie is re-issued with the new (now-verified) email so its
 * claims stay accurate without a forced sign-out, and the Stripe customer email
 * is kept in sync (best-effort).
 */
export async function POST(request: NextRequest) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const parsed = emailChangeCodeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const result = await confirmNewEmail(session.sub, parsed.data.code);
  if (!result.ok) {
    switch (result.reason) {
      case "NONE":
        return fail("No email change in progress. Start again.", 404);
      case "STAGE":
        return fail("Verify your current email first.", 409);
      case "EXPIRED":
        return fail("This request expired. Please start again.", 410);
      case "LOCKED":
        return fail("Too many incorrect codes. Please start again.", 429);
      case "INVALID":
        return fail("That code is incorrect. Check your email and try again.", 400);
      case "TAKEN":
        return fail("That email address was just taken. Please start again.", 409);
    }
  }

  const { user } = result;

  // Refresh the session so the JWT carries the new, verified email.
  await createSession({
    sub: user.id,
    email: user.email,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    emailVerified: user.emailVerified !== null,
    policyAccepted: user.policyAcceptedAt !== null,
  });

  // Best-effort: a failed sync must not undo the committed email change.
  if (user.stripeCustomerId) {
    try {
      await stripe().customers.update(user.stripeCustomerId, { email: user.email });
    } catch (error) {
      console.error("Stripe customer email sync failed:", error);
    }
  }

  return ok({ user: toPublicUser(user), email: user.email });
}
