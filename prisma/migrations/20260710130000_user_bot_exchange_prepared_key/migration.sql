-- Record WHAT was prepared on the exchange, not merely that something was.
--
-- `exchangePreparedAt` was a timestamp: it could say "prepared" while the settings
-- it stood for had since changed. Leverage moves when an admin edits a bot's risk
-- class, the symbol moves with its ticker, and the mode flips when a demo key is
-- replaced by a live one. In each case the next order would have gone out at the
-- wrong leverage. `exchangePrepared` stores `exchange|mode|symbol|leverage`, so a
-- mismatch re-prepares and no caller has to remember to invalidate anything.
--
-- Safe drop: the column was introduced one migration ago and never written.

-- AlterTable
ALTER TABLE "user_bots" DROP COLUMN "exchangePreparedAt",
ADD COLUMN     "exchangePrepared" TEXT;
