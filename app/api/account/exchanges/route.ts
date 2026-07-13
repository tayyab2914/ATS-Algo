import type { NextRequest } from "next/server";
import { fail, ok, zodFail } from "@/lib/api";
import { maskApiKey } from "@/lib/account";
import { requireMember } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { CURRENT_KEY_VERSION, encryptSecret } from "@/lib/crypto/secrets";
import { exchangeEnabled } from "@/lib/bot-exchanges";
import { validateExchangeKey } from "@/lib/exchanges/validate";
import { exchangeAddSchema, exchangeRemoveSchema } from "@/lib/validation";

// node:crypto (AES-GCM) and ccxt need the Node runtime; validation makes a
// network round-trip to the exchange, so allow a little longer than the default.
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Connect an exchange: validate the key against the exchange read-only, then store
 * the key + secret (+ passphrase) ENCRYPTED at rest. Only a masked key is kept for
 * display; the derived permission scope is stored, not a hardcoded constant.
 */
export async function POST(request: NextRequest) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const parsed = exchangeAddSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  const { exchange, apiKey, apiSecret, passphrase } = parsed.data;

  if (!exchangeEnabled(exchange)) {
    return fail(`${exchange} connections aren't available yet.`, 400);
  }

  // Validate the key against the exchange (read-only) before persisting anything.
  const result = await validateExchangeKey(exchange, {
    apiKey,
    apiSecret,
    passphrase: passphrase || undefined,
  });
  if (!result.ok) return fail(result.message, result.status);

  // Bind ciphertext to this user+exchange so a leaked row can't be replayed.
  const aad = `${session.sub}:${exchange}`;
  const data = {
    apiKeyMasked: maskApiKey(apiKey),
    apiKeyEnc: encryptSecret(apiKey, aad),
    apiSecretEnc: encryptSecret(apiSecret, aad),
    passphraseEnc: passphrase ? encryptSecret(passphrase, aad) : null,
    sandbox: result.sandbox, // auto-detected: demo (true) vs live (false) key
    keyVersion: CURRENT_KEY_VERSION,
    permissions: result.permissions,
    lastVerifiedAt: new Date(),
  };

  const connection = await prisma.exchangeConnection.upsert({
    where: { userId_exchange: { userId: session.sub, exchange } },
    update: data,
    create: { userId: session.sub, exchange, ...data },
  });

  return ok({ exchange: connection.exchange, permissions: connection.permissions });
}

/** Remove an exchange connection. */
export async function DELETE(request: NextRequest) {
  const access = await requireMember();
  if ("error" in access) return access.error;
  const { session } = access;

  const parsed = exchangeRemoveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return zodFail(parsed.error);

  await prisma.exchangeConnection.deleteMany({
    where: { userId: session.sub, exchange: parsed.data.exchange },
  });

  return ok({ removed: parsed.data.exchange });
}
