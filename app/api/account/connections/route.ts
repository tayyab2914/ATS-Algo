import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { connectionToggleSchema } from "@/lib/validation";

/** Toggle the TradingView or Wallet connection for the signed-in user. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  const parsed = connectionToggleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { target, connected, address } = parsed.data;

  const data =
    target === "tradingview"
      ? { tradingViewConnected: connected }
      : { walletConnected: connected, walletAddress: connected ? (address ?? generatePlaceholderAddress()) : null };

  await prisma.user.update({ where: { id: session.sub }, data });
  return ok({ ...data });
}

/** Placeholder wallet address when none is supplied (no real wallet provider here). */
function generatePlaceholderAddress(): string {
  const hex = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `0x${hex}`;
}
