-- Admin-allowed exchanges per bot (1..3). The user picks one of these per
-- deployment. Backfill from the existing single `exchange` column.
ALTER TABLE "bots" ADD COLUMN "exchanges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "bots" SET "exchanges" = ARRAY["exchange"] WHERE "exchange" IS NOT NULL AND "exchange" <> '';
