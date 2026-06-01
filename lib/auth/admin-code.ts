import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { sendAdminCodeEmail } from "@/lib/email";

/**
 * Passwordless admin sign-in via a one-time code emailed to ADMIN_EMAIL.
 * Codes are stored hashed and expire quickly; only the latest is valid.
 */

const CODE_TTL_MS = 1000 * 60 * 10; // 10 minutes

function generateCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4 digits
}

/** Issue a fresh admin code (invalidating any prior one) and email it. */
export async function createAndSendAdminCode(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error("ADMIN_EMAIL is not set");

  const code = generateCode();
  await prisma.adminLoginCode.deleteMany({});
  await prisma.adminLoginCode.create({
    data: { codeHash: await hashPassword(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });

  await sendAdminCodeEmail(adminEmail, code);
}

/** Verify a submitted admin code; consumes all codes on success. */
export async function verifyAdminCode(code: string): Promise<boolean> {
  const record = await prisma.adminLoginCode.findFirst({ orderBy: { createdAt: "desc" } });
  if (!record) return false;

  if (record.expiresAt < new Date()) {
    await prisma.adminLoginCode.deleteMany({});
    return false;
  }

  const valid = await verifyPassword(code, record.codeHash);
  if (valid) await prisma.adminLoginCode.deleteMany({});
  return valid;
}
