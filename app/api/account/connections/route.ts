import type { NextRequest } from "next/server";
import { ok, zodFail } from "@/lib/api";
import { requireMember } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { connectionToggleSchema } from "@/lib/validation";

/** Toggle the TradingView connection for the signed-in user. */
export async function POST(request: NextRequest) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const parsed = connectionToggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { connected } = parsed.data;
  const data = { tradingViewConnected: connected };

  await prisma.user.update({ where: { id: session.sub }, data });
  return ok({ ...data });
}
