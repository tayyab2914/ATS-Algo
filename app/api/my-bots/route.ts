import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { requireMember } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

/**
 * Add a bot from the library to the signed-in member's "My Bots". Idempotent —
 * re-adding the same bot is a no-op that returns the existing row. The bot lands
 * in the Non-Active tab (active = false) until the user activates it. Deploying
 * is a paid feature, so this is gated to members via {@link requireMember}.
 */
const addSchema = z.object({ botId: z.string().min(1) });

export async function POST(request: NextRequest) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const parsed = addSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const { botId } = parsed.data;

  // Only an existing, publicly-visible (ACTIVE) bot can be added.
  const bot = await prisma.bot.findFirst({ where: { id: botId, status: "ACTIVE" }, select: { id: true } });
  if (!bot) return fail("Bot not found", 404);

  const userBot = await prisma.userBot.upsert({
    where: { userId_botId: { userId: session.sub, botId } },
    create: { userId: session.sub, botId },
    update: {}, // already added — leave its active/capital state untouched
    select: { id: true, active: true },
  });

  return ok({ userBot }, 201);
}
