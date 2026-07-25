-- One signal secret for every bot, and an idempotency key the receiver derives itself.
--
-- The TradingView payload no longer carries `bot_id`, `ts` or `side`: the URL names the
-- bot, the action names the direction (`enter_long` / `enter_short`), and the secret is a
-- single shared value in `SIGNAL_SECRET` because it is configured once in the ATS
-- indicator's settings rather than per alert.
--
-- DESTRUCTIVE: drops every bot's per-bot signal secret. They are dead once the receiver
-- compares against the environment, and are unrecoverable by design (encrypted, never
-- readable back), so there is nothing to migrate. Set SIGNAL_SECRET before deploying or
-- every webhook returns 401.

-- 1. Replace the (botId, action, ts) dedupe key with (botId, dedupeKey).
--    Existing rows are backfilled from their own id: each is unique, already acted on,
--    and can never collide with a future "<ACTION>[:<SIDE>]:<window>" key.
DROP INDEX IF EXISTS "signals_botId_action_ts_key";

ALTER TABLE "signals" ADD COLUMN "dedupeKey" TEXT;
UPDATE "signals" SET "dedupeKey" = 'legacy:' || "id" WHERE "dedupeKey" IS NULL;
ALTER TABLE "signals" ALTER COLUMN "dedupeKey" SET NOT NULL;
ALTER TABLE "signals" DROP COLUMN "ts";

CREATE UNIQUE INDEX "signals_botId_dedupeKey_key" ON "signals"("botId", "dedupeKey");

-- 2. The per-bot secret is gone.
ALTER TABLE "bots" DROP COLUMN "signalSecretEnc";
ALTER TABLE "bots" DROP COLUMN "signalKeyVersion";
