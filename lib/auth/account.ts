import crypto from "node:crypto";
import { appBaseUrl } from "@/lib/app-url";
import { prisma } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email";
import type { UserModel } from "@/lib/generated/prisma/models";
import { GUEST_TRIAL_MS } from "@/lib/guest";

const VERIFICATION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

/** The shape of a user safe to return to the client (never includes the hash). */
export type PublicUser = {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  emailVerified: boolean;
};

export function toPublicUser(user: UserModel): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    emailVerified: user.emailVerified !== null,
  };
}

/** Is this the configured superadmin address? */
export function isSuperAdminEmail(email: string): boolean {
  const configured = (process.env.SUPERADMIN_EMAIL ?? "").trim().toLowerCase();
  return configured.length > 0 && email.trim().toLowerCase() === configured;
}

/**
 * Is this a configured admin address? True for ADMIN_EMAIL and for the
 * SUPERADMIN_EMAIL — the superadmin signs in through the same passwordless admin
 * flow, so it must be recognised as an admin address here too.
 */
export function isAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  return (adminEmail.length > 0 && normalized === adminEmail) || isSuperAdminEmail(normalized);
}

/**
 * Does this email belong to an admin who may use passwordless admin sign-in?
 * True for the configured ADMIN_EMAIL, or any account explicitly granted the
 * ADMIN role from Admin Management — provided that account is in good standing.
 */
export async function isAdmin(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (isAdminEmail(normalized)) return true;
  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { role: true, status: true },
  });
  return user?.role === "ADMIN" && user.status === "ACTIVE";
}

/**
 * Create a single-use verification token and email the confirmation link.
 * Email failures are surfaced to the caller so signup can report "account
 * created, but verification email failed" without rolling back the user.
 */
export async function issueVerificationEmail(userId: string, email: string): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  // Invalidate any earlier links so only the newest one works (single active
  // token), the same way password-reset tokens are issued.
  await prisma.verificationToken.deleteMany({ where: { userId } });
  await prisma.verificationToken.create({
    data: { token, userId, expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
  });
  const base = appBaseUrl();
  await sendVerificationEmail(email, `${base}/api/auth/verify?token=${token}`);
}

/**
 * Start the Guest Mode trial clock the first time a non-admin signs in.
 *
 * Called from the login paths once the session is about to be created. The clock
 * starts on first login (not at signup) so a verification email sitting unopened
 * doesn't eat into the free days. Idempotent: only sets `guestExpiresAt` when it
 * is still null, so a returning guest keeps their original deadline and a member
 * is unaffected (an active subscription supersedes the trial regardless).
 *
 * Admins never get a trial. `updateMany` guards against a since-deleted row.
 */
export async function startGuestTrialIfNeeded(user: {
  id: string;
  role: UserModel["role"];
  guestExpiresAt: Date | null;
}): Promise<void> {
  if (user.role === "ADMIN" || user.guestExpiresAt !== null) return;
  await prisma.user.updateMany({
    where: { id: user.id, guestExpiresAt: null },
    data: { guestExpiresAt: new Date(Date.now() + GUEST_TRIAL_MS) },
  });
}
