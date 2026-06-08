import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { connectionToggleSchema } from "@/lib/validation";

/** Toggle the TradingView connection for the signed-in user. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  const parsed = connectionToggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { connected } = parsed.data;
  const data = { tradingViewConnected: connected };

  await prisma.user.update({ where: { id: session.sub }, data });
  return ok({ ...data });
}
