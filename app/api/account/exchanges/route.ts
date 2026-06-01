import type { NextRequest } from "next/server";
import { ok, fail, zodFail } from "@/lib/api";
import { maskApiKey } from "@/lib/account";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { exchangeAddSchema, exchangeRemoveSchema } from "@/lib/validation";

/** Connect an exchange (stores a masked key — never the raw key or secret). */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  const parsed = exchangeAddSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { exchange, apiKey } = parsed.data;

  const connection = await prisma.exchangeConnection.upsert({
    where: { userId_exchange: { userId: session.sub, exchange } },
    update: { apiKeyMasked: maskApiKey(apiKey), permissions: "Read & Trade" },
    create: { userId: session.sub, exchange, apiKeyMasked: maskApiKey(apiKey), permissions: "Read & Trade" },
  });

  return ok({ exchange: connection.exchange, permissions: connection.permissions });
}

/** Remove an exchange connection. */
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return fail("Not authenticated", 401);

  const parsed = exchangeRemoveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  await prisma.exchangeConnection.deleteMany({
    where: { userId: session.sub, exchange: parsed.data.exchange },
  });

  return ok({ removed: parsed.data.exchange });
}
