import type { NextRequest } from "next/server";
import { z } from "zod";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

const nameSchema = z.object({ name: z.string().trim().min(1, "Category name is required").max(60) });

/** List all categories. */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const categories = await prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  return ok({ categories });
}

/** Create a new category. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const parsed = nameSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  try {
    const category = await prisma.category.create({ data: { name: parsed.data.name }, select: { id: true, name: true } });
    return ok({ category }, 201);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return fail("A category with that name already exists.", 409);
    throw error;
  }
}
