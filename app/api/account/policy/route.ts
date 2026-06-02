import { ok, fail } from "@/lib/api";
import { createSession, getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Record the signed-in user's acceptance of the mandatory Rules & Policy.
 *
 * Stamps `policyAcceptedAt` and re-issues the session cookie with
 * `policyAccepted: true` so the edge proxy stops gating them on the next
 * navigation. Idempotent: accepting again simply refreshes the timestamp.
 */
export async function POST() {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  const user = await prisma.user.update({
    where: { id: session.sub },
    data: { policyAcceptedAt: new Date() },
  });

  await createSession({
    sub: user.id,
    email: user.email,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    emailVerified: user.emailVerified !== null,
    policyAccepted: true,
  });

  return ok({ accepted: true });
}
