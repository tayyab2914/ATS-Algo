import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CURRENT_KEY_VERSION, decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { prisma } from "@/lib/db";

/**
 * The shared secret a bot's TradingView alert carries in its JSON body.
 *
 * TradingView can only post a static payload to a fixed URL — it cannot sign a
 * request — so the "signature" is a bearer token compared in constant time. It is
 * per bot, not global: leaking one bot's alert body must not let an attacker fire
 * signals for every other bot.
 *
 * Stored the same way as exchange credentials: AES-256-GCM, with the bot id as
 * additional authenticated data. A bot fans out to many members, so there is no
 * single user to bind it to.
 */

export function generateSignalSecret(): string {
  return randomBytes(32).toString("base64url");
}

/** Mint a new secret for a bot, returning the plaintext once. It is never readable again. */
export async function rotateSignalSecret(botId: string): Promise<string> {
  const secret = generateSignalSecret();
  await prisma.bot.update({
    where: { id: botId },
    data: { signalSecretEnc: encryptSecret(secret, botId), signalKeyVersion: CURRENT_KEY_VERSION },
  });
  return secret;
}

/**
 * Constant-time check of a presented secret.
 *
 * Both sides are hashed before comparison so the comparison is over fixed-length
 * buffers: `timingSafeEqual` throws on a length mismatch, and short-circuiting on
 * length would leak how long the real secret is.
 *
 * A bot with no secret configured can never be triggered.
 */
export function signalSecretMatches(botId: string, signalSecretEnc: string | null, presented: string | undefined): boolean {
  if (!signalSecretEnc || !presented) return false;

  let expected: string;
  try {
    expected = decryptSecret(signalSecretEnc, botId);
  } catch {
    return false; // wrong key, tampered ciphertext, or a secret minted for another bot
  }

  const a = createHash("sha256").update(expected, "utf8").digest();
  const b = createHash("sha256").update(presented, "utf8").digest();
  return timingSafeEqual(a, b);
}
