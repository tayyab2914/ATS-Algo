import { ok } from "@/lib/api";
import { destroySession, getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function POST() {
  // Stamp the revocation cutoff so the session reads as signed-out everywhere
  // (admin Members view, and any lingering copy of the token). `updateMany`
  // keeps this a no-op for guests / already-invalid sessions.
  const session = await getSession();
  if (session) {
    await prisma.user.updateMany({
      where: { id: session.sub },
      data: { sessionsValidFrom: new Date() },
    });
  }

  await destroySession();
  return ok({ ok: true });
}
