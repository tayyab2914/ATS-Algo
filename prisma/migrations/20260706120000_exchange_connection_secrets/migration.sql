-- Encrypted exchange credentials (AES-256-GCM). Ciphertext columns are nullable so
-- existing masked-only rows survive; keyVersion supports future key rotation, and
-- lastVerifiedAt records the last successful read-only validation.
ALTER TABLE "exchange_connections"
  ADD COLUMN "apiKeyEnc" TEXT,
  ADD COLUMN "apiSecretEnc" TEXT,
  ADD COLUMN "passphraseEnc" TEXT,
  ADD COLUMN "keyVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastVerifiedAt" TIMESTAMP(3);
