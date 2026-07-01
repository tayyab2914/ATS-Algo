import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { requireMember } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";

/**
 * Update or remove one of the member's bots. Keyed by `botId` (a user holds at
 * most one row per bot), so the client always has the id to hand.
 *
 * PATCH  — activate/deactivate (`active`) or set the allocated capital.
 * DELETE — remove the bot from My Bots entirely.
 */
const patchSchema = z
  .object({
    active: z.boolean().optional(),
    allocatedCapital: z.number().min(0).max(1_000_000_000).optional(),
    // Bot Settings fields.
    allocationType: z.enum(["FIXED", "PERCENTAGE"]).optional(),
    capitalPerTrade: z.number().min(0).max(1_000_000_000).optional(),
    compounding: z.boolean().optional(),
    exchangeSource: z.string().max(64).nullable().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: "Nothing to update",
  });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const { botId } = await params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  // updateMany scopes the write to the owner, so one user can't touch another's row.
  const result = await prisma.userBot.updateMany({
    where: { userId: session.sub, botId },
    data: parsed.data,
  });
  if (result.count === 0) return fail("Bot not in your list", 404);

  return ok({ updated: true });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const { botId } = await params;
  const result = await prisma.userBot.deleteMany({ where: { userId: session.sub, botId } });
  if (result.count === 0) return fail("Bot not in your list", 404);

  return ok({ removed: true });
}
