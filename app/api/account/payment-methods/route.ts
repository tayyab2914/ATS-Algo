import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { requireMember } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import {
  cardLast4,
  detectCardBrand,
  isCardExpired,
  MAX_PAYMENT_METHODS,
  type PaymentMethodView,
} from "@/lib/payment";
import { paymentMethodAddSchema, paymentMethodIdSchema } from "@/lib/validation";

/** Shape a stored row into the client-safe view (no sensitive data exists to leak). */
function toView(card: {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  holderName: string;
  label: string | null;
  isDefault: boolean;
}): PaymentMethodView {
  return {
    id: card.id,
    brand: card.brand,
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear,
    holderName: card.holderName,
    label: card.label,
    isDefault: card.isDefault,
    expired: isCardExpired(card.expMonth, card.expYear),
  };
}

/**
 * Save a personal payment card. The full card number arrives over HTTPS, is
 * validated (Luhn + not-expired) and used only to derive the brand and last four
 * — the PAN is then discarded and never written. The CVV is never transmitted.
 * Members only; a guest's account is read-only until they upgrade.
 */
export async function POST(request: NextRequest) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const parsed = paymentMethodAddSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { number, expMonth, expYear, holderName, label } = parsed.data;

  const count = await prisma.paymentMethod.count({ where: { userId: session.sub } });
  if (count >= MAX_PAYMENT_METHODS) {
    return fail(`You can save up to ${MAX_PAYMENT_METHODS} cards. Remove one to add another.`, 409);
  }

  try {
    const card = await prisma.paymentMethod.create({
      data: {
        userId: session.sub,
        brand: detectCardBrand(number),
        last4: cardLast4(number),
        expMonth,
        expYear,
        holderName,
        label: label || null,
        // The first card a user saves becomes their default automatically.
        isDefault: count === 0,
      },
    });
    return ok({ paymentMethod: toView(card) }, 201);
  } catch (error) {
    // Unique violation on (userId, brand, last4, expMonth, expYear) — same card.
    if ((error as { code?: string }).code === "P2002") {
      return fail("That card is already saved.", 409);
    }
    throw error;
  }
}

/**
 * Set one of the user's saved cards as the default. Ownership is verified before
 * any change so a bad id can never clear the existing default without replacing
 * it. The clear-then-set runs in a single transaction to preserve the
 * "exactly one default" invariant.
 */
export async function PATCH(request: NextRequest) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const parsed = paymentMethodIdSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const { id } = parsed.data;

  const owned = await prisma.paymentMethod.findFirst({
    where: { id, userId: session.sub },
    select: { id: true },
  });
  if (!owned) return fail("Payment method not found", 404);

  await prisma.$transaction([
    prisma.paymentMethod.updateMany({
      where: { userId: session.sub, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.paymentMethod.updateMany({
      where: { id, userId: session.sub },
      data: { isDefault: true },
    }),
  ]);

  return ok({ id, isDefault: true });
}

/**
 * Remove a saved card. Scoped to the owner so a user can only delete their own.
 * If the removed card was the default, the most recently added remaining card is
 * promoted so a user with cards left always has a default.
 */
export async function DELETE(request: NextRequest) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const parsed = paymentMethodIdSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);
  const { id } = parsed.data;

  const card = await prisma.paymentMethod.findFirst({
    where: { id, userId: session.sub },
    select: { id: true, isDefault: true },
  });
  if (!card) return fail("Payment method not found", 404);

  // When the default is removed, promote the newest remaining card so a user
  // with cards left always has a default. The id is returned so the client can
  // reflect the promotion without a refetch.
  let newDefaultId: string | null = null;
  if (card.isDefault) {
    const next = await prisma.paymentMethod.findFirst({
      where: { userId: session.sub, id: { not: id } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    newDefaultId = next?.id ?? null;
    const ops = [prisma.paymentMethod.delete({ where: { id } })];
    if (next) {
      ops.push(prisma.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } }));
    }
    await prisma.$transaction(ops);
  } else {
    await prisma.paymentMethod.delete({ where: { id } });
  }

  return ok({ removed: id, newDefaultId });
}
