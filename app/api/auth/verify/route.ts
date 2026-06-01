import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Email verification link target. Marks the address confirmed, consumes the
 * token, refreshes the session if the owner is signed in, and redirects back
 * into the app with a status flag.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const base = process.env.APP_URL ?? request.nextUrl.origin;

  const record = token
    ? await prisma.verificationToken.findUnique({ where: { token } })
    : null;

  if (!record || record.expiresAt < new Date()) {
    if (record) await prisma.verificationToken.delete({ where: { id: record.id } }).catch(() => {});
    return NextResponse.redirect(new URL("/login?verify=invalid", base));
  }

  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { emailVerified: new Date() },
  });

  // Consume every outstanding token for this user.
  await prisma.verificationToken.deleteMany({ where: { userId: user.id } });

  // Send the now-verified user to the login page to sign in.
  return NextResponse.redirect(new URL("/login?verified=1", base));
}
