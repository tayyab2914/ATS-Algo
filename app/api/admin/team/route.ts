import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { adminSetRoleSchema } from "@/lib/validation";

/**
 * "Add Team Member" — grant a role to an existing account by email. There is no
 * separate invite flow: the person must already have signed up. Changing a role
 * also invalidates the member's live sessions, because the role is baked into
 * the session JWT at login; forcing a re-login is what makes the new role take
 * effect.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const parsed = adminSetRoleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const { email, role } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (!user) {
    return fail("No account found for that email. Ask them to sign up first.", 404);
  }
  if (user.id === session.sub) {
    return fail("You can't change your own role here.", 409);
  }
  if (user.role === role) {
    return fail(`That member is already ${role === "ADMIN" ? "an admin" : "a member"}.`, 409);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { role, sessionsValidFrom: new Date() },
  });

  return ok({ ok: true });
}
