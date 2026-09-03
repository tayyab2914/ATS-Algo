import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { communityLinkUpdateSchema } from "@/lib/validation";

/**
 * Rename a Community Access Link, or switch it on/off.
 *
 * The SLUG is deliberately not editable. A community has already published its
 * link in a Discord, a pinned message and half a dozen screenshots by the time
 * anybody wants to rename it; changing the slug would break every one of those
 * and 404 the people following them. The display name is free to change because
 * nothing points at it.
 *
 * Deactivating stops NEW registrations and nothing else — see the model comment.
 * The members who already joined keep their access, because a mis-click on this
 * switch must not be able to lock out an entire community.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id } = await params;
  const parsed = communityLinkUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { name, active } = parsed.data;
  if (name === undefined && active === undefined) return fail("Nothing to update", 400);

  const existing = await prisma.communityLink.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return fail("Community link not found", 404);

  const link = await prisma.communityLink.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(active !== undefined ? { active } : {}),
    },
    select: { id: true, name: true, slug: true, active: true },
  });

  return ok({ link });
}

/**
 * Delete a Community Access Link.
 *
 * This retires the URL and throws away the click history with it (the clicks
 * cascade). It does NOT touch the people who joined through it: their
 * `communityLinkId` is set to null by the foreign key and their access grant —
 * a row of its own — is untouched. Deleting costs the attribution, never a
 * member's account or their bots.
 *
 * Because the sign-up numbers disappear with the row, the UI asks for a typed
 * confirmation rather than offering this as a one-click row action. Pausing is
 * the reversible option and is what an admin almost always wants.
 */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return fail("Admin access required", 403);

  const { id } = await params;
  const existing = await prisma.communityLink.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return fail("Community link not found", 404);

  await prisma.communityLink.delete({ where: { id } });
  return ok({ id });
}
