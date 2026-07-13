/**
 * Sanity checks for the AES-256-GCM secret encryption (lib/crypto/secrets.ts).
 * Run with an ENCRYPTION_KEY set, e.g.:
 *   ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")" npx tsx scripts/verify-secrets.ts
 */
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret } from "../lib/crypto/secrets";

const aad = "user_123:Bitget";
const secret = "bg_super_secret_value_1234567890";

const packed = encryptSecret(secret, aad);
assert.equal(packed.split(".").length, 3, "packed token should be iv.tag.ct");
assert.equal(decryptSecret(packed, aad), secret, "round-trip should recover the plaintext");

// Tampered ciphertext must fail the GCM auth tag.
const [iv, tag, ct] = packed.split(".");
const flippedCt = (ct[0] === "A" ? "B" : "A") + ct.slice(1);
assert.throws(() => decryptSecret([iv, tag, flippedCt].join("."), aad), "tampered ciphertext must throw");

// Wrong AAD (different user/exchange) must fail.
assert.throws(() => decryptSecret(packed, "user_999:Bitget"), "mismatched AAD must throw");

// A random IV per call means the same plaintext encrypts differently every time.
assert.notEqual(encryptSecret(secret, aad), encryptSecret(secret, aad), "IV should randomize ciphertext");

console.log("✓ secrets: round-trip, tamper-detection, AAD-binding, IV-uniqueness all passed");
