import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { toPublicUser } from "@/lib/auth/account";
import { hashPassword } from "@/lib/auth/password";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { profileSchema } from "@/lib/validation";

/** Update the signed-in user's profile (username, email, password, avatar). */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { username, email, password, avatarUrl } = parsed.data;
  const data: Record<string, unknown> = {};

  if (username) data.name = username;
  if (avatarUrl) data.avatarUrl = avatarUrl;
  if (password) data.passwordHash = await hashPassword(password);

  if (email && email !== session.email) {
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken && taken.id !== session.sub) return fail("That email is already in use", 409);
    data.email = email;
  }

  if (Object.keys(data).length === 0) return fail("Nothing to update", 400);

  const user = await prisma.user.update({ where: { id: session.sub }, data });
  return ok({ user: toPublicUser(user) });
}
