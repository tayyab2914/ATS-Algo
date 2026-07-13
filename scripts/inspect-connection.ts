/**
 * After connecting an exchange in the web app, prove the credentials are stored
 * ENCRYPTED at rest and that they decrypt back correctly — without printing the
 * actual secret. Needs ENCRYPTION_KEY (loaded from .env).
 *   CHECK_EMAIL="you@example.com" CHECK_EXCHANGE="Bitget" npx tsx scripts/inspect-connection.ts
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import { getDecryptedConnection } from "../lib/exchanges/connection";

async function main() {
  const email = (process.env.CHECK_EMAIL ?? "you@example.com").toLowerCase();
  const exchange = process.env.CHECK_EXCHANGE ?? "Bitget";

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return console.log(`No user for ${email}`);

  const row = await prisma.exchangeConnection.findUnique({
    where: { userId_exchange: { userId: user.id, exchange } },
  });
  if (!row) return console.log(`No ${exchange} connection stored for ${email} yet.`);

  console.log("Stored row (only ciphertext prefixes / presence shown — no plaintext):");
  console.log(
    JSON.stringify(
      {
        exchange: row.exchange,
        permissions: row.permissions,
        apiKeyMasked: row.apiKeyMasked,
        keyVersion: row.keyVersion,
        lastVerifiedAt: row.lastVerifiedAt,
        apiKeyEnc_prefix: row.apiKeyEnc ? row.apiKeyEnc.slice(0, 20) + "…" : null,
        apiSecretEnc_present: Boolean(row.apiSecretEnc),
        passphraseEnc_present: Boolean(row.passphraseEnc),
      },
      null,
      2,
    ),
  );

  const dec = await getDecryptedConnection(user.id, exchange);
  if (dec) {
    console.log("\nDecrypt round-trip OK (recovered values, secret not shown):");
    console.log(
      JSON.stringify(
        {
          apiKey_last4: dec.apiKey.slice(-4),
          apiSecret_length: dec.apiSecret.length,
          passphrase_present: Boolean(dec.passphrase),
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((e) => {
    console.error("Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
