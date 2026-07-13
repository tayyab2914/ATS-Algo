import "server-only";
import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto/secrets";

export type DecryptedConnection = {
  exchange: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  permissions: string;
  /** True for a demo/paper key — execution runs against the sandbox engine. */
  sandbox: boolean;
};

/**
 * Fetch a user's exchange connection and decrypt its credentials for server-side
 * use (the future trade-execution engine will consume this). Returns null when
 * there's no connection, or when the row predates encrypted storage (masked-only)
 * and must be re-connected. Server-only — never import into client code.
 */
export async function getDecryptedConnection(
  userId: string,
  exchange: string,
): Promise<DecryptedConnection | null> {
  const row = await prisma.exchangeConnection.findUnique({
    where: { userId_exchange: { userId, exchange } },
  });
  if (!row || !row.apiKeyEnc || !row.apiSecretEnc) return null;

  const aad = `${userId}:${exchange}`;
  return {
    exchange,
    apiKey: decryptSecret(row.apiKeyEnc, aad),
    apiSecret: decryptSecret(row.apiSecretEnc, aad),
    passphrase: row.passphraseEnc ? decryptSecret(row.passphraseEnc, aad) : undefined,
    permissions: row.permissions,
    sandbox: row.sandbox,
  };
}
