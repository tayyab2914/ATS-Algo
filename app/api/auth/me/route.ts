import { ok, fail } from "@/lib/api";
import { toPublicUser } from "@/lib/auth/account";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  // Read fresh from the DB so role / verification changes take effect.
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user) return fail("Not authenticated", 401);

  return ok({ user: toPublicUser(user) });
}
