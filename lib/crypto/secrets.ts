import crypto from "node:crypto";

/**
 * Reversible at-rest encryption for sensitive secrets (exchange API keys/secrets/
 * passphrases). AES-256-GCM — authenticated, so tampering is detected on decrypt.
 *
 * Node runtime only (the sync GCM API isn't available on the Edge runtime); any
 * route importing this must run on `runtime = "nodejs"`.
 *
 * The key comes from `ENCRYPTION_KEY` (base64-encoded 32 bytes). Generate one with:
 *   openssl rand -base64 32
 */

/** Bump when the encryption key is rotated; stored per-row as `keyVersion`. */
export const CURRENT_KEY_VERSION = 1;

// Loaded lazily and cached so `next build` never throws when ENCRYPTION_KEY is
// unset (mirrors the lazy Stripe client in lib/stripe.ts).
let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set — cannot encrypt/decrypt exchange credentials.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes (got ${key.length}). Generate one with: openssl rand -base64 32`,
    );
  }
  cachedKey = key;
  return key;
}

/**
 * Encrypt `plaintext` into a self-describing packed token `"iv.tag.ct"` (each part
 * base64url). `aad` (additional authenticated data) binds the ciphertext to a
 * context — pass `${userId}:${exchange}` so a row's ciphertext can't be replayed
 * against a different user/exchange even if the DB is compromised.
 */
export function encryptSecret(plaintext: string, aad?: string): string {
  const iv = crypto.randomBytes(12); // 96-bit nonce, recommended for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

/**
 * Decrypt a packed token produced by {@link encryptSecret}. Throws if the token is
 * malformed, the key is wrong, the ciphertext was tampered with, or the `aad`
 * doesn't match what was used to encrypt.
 */
export function decryptSecret(packed: string, aad?: string): string {
  const parts = packed.split(".");
  if (parts.length !== 3) throw new Error("Malformed ciphertext token.");
  const [ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]);
  return pt.toString("utf8");
}
