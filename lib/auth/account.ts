import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { sendVerificationEmail } from "@/lib/email";
import type { UserModel } from "@/lib/generated/prisma/models";

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

/** Is this the configured admin address? */
export function isAdminEmail(email: string): boolean {
  return email.toLowerCase() === (process.env.ADMIN_EMAIL ?? "").toLowerCase();
}

/**
 * Create a single-use verification token and email the confirmation link.
 * Email failures are surfaced to the caller so signup can report "account
 * created, but verification email failed" without rolling back the user.
 */
export async function issueVerificationEmail(userId: string, email: string): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.verificationToken.create({
    data: { token, userId, expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
  });
  const base = process.env.APP_URL ?? "https://ats-algo.vercel.app";
  await sendVerificationEmail(email, `${base}/api/auth/verify?token=${token}`);
}
