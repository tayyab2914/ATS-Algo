import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const nameSchema = z.object({ name: z.string().trim().min(1, "Category name is required").max(60) });

/** Rename a category — the new name cascades to every bot using the old name. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id } = await params;
  const parsed = nameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const name = parsed.data.name;

  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) return fail("Category not found", 404);
  if (existing.name === name) return ok({ category: { id: existing.id, name } });

  try {
    await prisma.$transaction([
      prisma.category.update({ where: { id }, data: { name } }),
      prisma.bot.updateMany({ where: { category: existing.name }, data: { category: name } }),
    ]);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return fail("A category with that name already exists.", 409);
    throw error;
  }

  return ok({ category: { id, name } });
}

/** Delete a category — blocked while any bot still uses it. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id } = await params;
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) return fail("Category not found", 404);

  const inUse = await prisma.bot.count({ where: { category: existing.name } });
  if (inUse > 0) return fail(`Can't delete — ${inUse} bot${inUse === 1 ? "" : "s"} still use this category.`, 409);

  await prisma.category.delete({ where: { id } });
  return ok({ id });
}
