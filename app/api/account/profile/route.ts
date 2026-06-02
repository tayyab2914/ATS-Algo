import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { toPublicUser } from "@/lib/auth/account";
import { hashPassword } from "@/lib/auth/password";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { profileSchema } from "@/lib/validation";

/**
 * Update the signed-in user's profile (username, password, avatar).
 * Email is intentionally immutable here and is never updated, even if sent.
 */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  const parsed = profileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { username, password, avatarUrl } = parsed.data;
  const data: Record<string, unknown> = {};

  if (username) data.name = username;
  if (avatarUrl) data.avatarUrl = avatarUrl;
  if (password) data.passwordHash = await hashPassword(password);

  if (Object.keys(data).length === 0) return fail("Nothing to update", 400);

  const user = await prisma.user.update({ where: { id: session.sub }, data });
  return ok({ user: toPublicUser(user) });
}
