import crypto from "node:crypto";
import { appBaseUrl } from "@/lib/app-url";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";

/**
 * Password-reset tokens. The raw token is emailed; only its SHA-256 hash is
 * stored, so a database leak can't be used to reset accounts. Tokens are
 * single-use and expire after one hour.
 */

const RESET_TTL_MS = 1000 * 60 * 60; // 1 hour

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** Issue a fresh reset token (invalidating prior ones) and email the link. */
export async function createPasswordReset(userId: string, email: string): Promise<void> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await prisma.passwordResetToken.create({
    data: { tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });

  const base = appBaseUrl();
  await sendPasswordResetEmail(email, `${base}/reset-password?token=${token}`);
}

/**
 * Validate a reset token and, if good, set the new password and consume all of
 * the user's reset tokens. Returns `false` for missing/expired/invalid tokens.
 */
export async function consumePasswordReset(token: string, newPassword: string): Promise<boolean> {
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });

  if (!record || record.expiresAt < new Date()) {
    if (record) await prisma.passwordResetToken.delete({ where: { id: record.id } }).catch(() => {});
    return false;
  }

  await prisma.user.update({
    where: { id: record.userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  await prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } });
  return true;
}
