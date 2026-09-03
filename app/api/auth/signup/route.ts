import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { isAdminEmail, issueVerificationEmail, toPublicUser } from "@/lib/auth/account";
import { hashPassword } from "@/lib/auth/password";
import { activeLinkForSlug } from "@/lib/community/track";
import { prisma } from "@/lib/db";
import { signupSchema } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const parsed = signupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { email, password, ref } = parsed.data;
  const passwordHash = await hashPassword(password);
  const role = isAdminEmail(email) ? "ADMIN" : "USER";

  // The referral is re-resolved server-side. `ref` arrives from a query string
  // the user can edit, so it is treated as a claim to be checked, not a grant:
  // an unknown or DEACTIVATED slug yields null here and the account is created as
  // an ordinary read-only guest. This is also the point at which pausing a link
  // actually starts refusing people — a form left open in a tab before the pause
  // still posts the old slug.
  const link = role === "ADMIN" ? null : await activeLinkForSlug(ref);

  const existing = await prisma.user.findUnique({ where: { email } });

  // Only a *verified* account counts as a real member and blocks re-signup.
  // An unverified row is just a pending registration: nobody has proven they
  // own the address, so re-signing up refreshes it (new password) and sends a
  // fresh verification link instead of dead-ending on "already exists".
  if (existing && existing.emailVerified !== null) {
    return fail("An account with this email already exists", 409);
  }

  // Community sign-ups are granted access on the spot — that IS the link's
  // purpose: a community is onboarded once instead of member by member. An
  // open-ended grant (`currentPeriodEnd: null`) because nothing about a community
  // membership expires on a schedule; an admin revokes it per member if needed.
  //
  // One transaction, so an account can never exist with the referral recorded but
  // the grant missing (which would show as a community member locked out of the
  // bots they were promised). `upsert` on the grant covers the re-signup path,
  // where an unverified row may already carry one.
  const communityData = link
    ? { communityLinkId: link.id, communityJoinedAt: new Date() }
    : {};

  const user = await prisma.$transaction(async (tx) => {
    const record = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { passwordHash, role, ...communityData },
        })
      : await tx.user.create({ data: { email, passwordHash, role, ...communityData } });

    if (link) {
      await tx.subscription.upsert({
        where: { userId: record.id },
        create: { userId: record.id, currentPeriodEnd: null },
        update: { currentPeriodEnd: null },
      });
    }

    return record;
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

  return ok(
    {
      user: toPublicUser(user),
      emailSent,
      requiresVerification: true,
      /** The community they joined, so the form can confirm it by name. */
      community: link?.name ?? null,
    },
    201,
  );
}
