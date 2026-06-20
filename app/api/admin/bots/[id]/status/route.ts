import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

/**
 * Toggle a bot's visibility (ACTIVE / DISABLED). Deliberately lightweight: no
 * change message and no revision log — enabling/disabling is not a strategy
 * change, so it doesn't belong in the bot's history.
 */
const statusSchema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id } = await params;
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const updated = await prisma.bot.updateMany({ where: { id }, data: { status: parsed.data.status } });
  if (updated.count === 0) return fail("Bot not found", 404);

  return ok({ id, status: parsed.data.status });
}
