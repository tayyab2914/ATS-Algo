import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { sendTwoFactorCodeEmail } from "@/lib/email";

/**
 * Two-factor login: a 6-digit code emailed to a 2FA-enabled user after their
 * password checks out. Codes are stored hashed and expire quickly; only the
 * latest code per user is valid.
 *
 * The "pending" challenge between the password step and the code step is held
 * in a short-lived, httpOnly cookie carrying a signed JWT — never a full
 * session, so the user cannot reach protected routes until they pass 2FA.
 */

const CODE_TTL_MS = 1000 * 60 * 10; // 10 minutes
const PENDING_COOKIE = "ats_2fa_pending";
const PENDING_TTL_SECONDS = 60 * 10; // 10 minutes
const PENDING_PURPOSE = "2fa-pending";
const ISSUER = "adrian-trading-system";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

/** Issue a fresh 2FA code (invalidating any prior one) and email it. */
export async function createAndSendTwoFactorCode(userId: string, email: string): Promise<void> {
  const code = generateCode();
  await prisma.twoFactorCode.deleteMany({ where: { userId } });
  await prisma.twoFactorCode.create({
    data: { userId, codeHash: await hashPassword(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  await sendTwoFactorCodeEmail(email, code);
}

/** Verify a submitted 2FA code for a user; consumes the user's codes on success. */
export async function verifyTwoFactorCode(userId: string, code: string): Promise<boolean> {
  const record = await prisma.twoFactorCode.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return false;

  if (record.expiresAt < new Date()) {
    await prisma.twoFactorCode.deleteMany({ where: { userId } });
    return false;
  }

  const valid = await verifyPassword(code, record.codeHash);
  if (valid) await prisma.twoFactorCode.deleteMany({ where: { userId } });
  return valid;
}

/** Sign a pending-2FA challenge and write it to the short-lived cookie. */
export async function startPendingTwoFactor(userId: string): Promise<void> {
  const token = await new SignJWT({ purpose: PENDING_PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SECONDS}s`)
    .sign(getSecret());

  const store = await cookies();
  store.set(PENDING_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PENDING_TTL_SECONDS,
  });
}

/** Read the pending-2FA challenge; returns the awaiting user id, or null. */
export async function getPendingTwoFactor(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(PENDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: ISSUER });
    if (payload.purpose !== PENDING_PURPOSE || typeof payload.sub !== "string") return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/** Clear the pending-2FA challenge cookie. */
export async function clearPendingTwoFactor(): Promise<void> {
  const store = await cookies();
  store.delete(PENDING_COOKIE);
}
