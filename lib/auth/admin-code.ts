import { isAdmin } from "@/lib/auth/account";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";
import { sendAdminCodeEmail } from "@/lib/email";

/**
 * Passwordless admin sign-in via a one-time code emailed to an admin address.
 * Codes are stored hashed, scoped to the address they were sent to, and expire
 * quickly; only the latest code per address is valid.
 */

const CODE_TTL_MS = 1000 * 60 * 10; // 10 minutes

function generateCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4 digits
}

/**
 * Issue a fresh admin code for `email` and email it — but only when that address
 * actually belongs to an admin. Non-admin addresses are silently ignored so the
 * endpoint can't be used to enumerate who the admins are. Returns true when a
 * code was sent. Invalidates any prior code for the same address.
 */
export async function createAndSendAdminCode(rawEmail: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  if (!(await isAdmin(email))) return false;

  const code = generateCode();
  await prisma.adminLoginCode.deleteMany({ where: { email } });
  await prisma.adminLoginCode.create({
    data: { email, codeHash: await hashPassword(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });

  await sendAdminCodeEmail(email, code);
  return true;
}

/** Verify a submitted admin code for `email`; consumes that address's codes on success. */
export async function verifyAdminCode(rawEmail: string, code: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  const record = await prisma.adminLoginCode.findFirst({
    where: { email },
    orderBy: { createdAt: "desc" },
  });
  if (!record) return false;

  if (record.expiresAt < new Date()) {
    await prisma.adminLoginCode.deleteMany({ where: { email } });
    return false;
  }

  const valid = await verifyPassword(code, record.codeHash);
  if (valid) await prisma.adminLoginCode.deleteMany({ where: { email } });
  return valid;
}
