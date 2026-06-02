import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { twoFactorToggleSchema } from "@/lib/validation";

/** Enable or disable email-based two-factor authentication for the signed-in user. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  const parsed = twoFactorToggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { enabled } = parsed.data;

  await prisma.user.update({
    where: { id: session.sub },
    data: { twoFactorEnabled: enabled },
  });

  // Drop any outstanding login codes when turning 2FA off.
  if (!enabled) {
    await prisma.twoFactorCode.deleteMany({ where: { userId: session.sub } });
  }

  return ok({ twoFactorEnabled: enabled });
}
