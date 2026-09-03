import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { normalizeSlug, slugProblem } from "@/lib/community/slug";
import { prisma } from "@/lib/db";
import { communityLinkCreateSchema } from "@/lib/validation";

/**
 * Create a Community Access Link.
 *
 * The slug is derived from the name when the admin doesn't type one, which is
 * the common case ("House of Crypto" → `house-of-crypto`). Either way it is
 * NORMALISED and vetted here rather than trusted from the form: this value
 * becomes a route at the root of the domain, so a slug that collides with a real
 * page would produce a link that silently opens the wrong screen. See
 * `lib/community/slug.ts`.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const parsed = communityLinkCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { name } = parsed.data;
  const slug = normalizeSlug(parsed.data.slug?.trim() || name);

  const problem = slugProblem(slug);
  if (problem) return fail(problem, 422);

  try {
    const link = await prisma.communityLink.create({
      data: { name, slug },
      select: { id: true, name: true, slug: true, active: true },
    });
    return ok({ link }, 201);
  } catch (error) {
    // The unique index is the authority on collisions, not a prior read — two
    // admins creating the same community at once would race past a check.
    if ((error as { code?: string }).code === "P2002") {
      return fail(`The link /${slug} is already taken by another community.`, 409);
    }
    throw error;
  }
}
