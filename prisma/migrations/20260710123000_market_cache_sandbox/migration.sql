-- Key the market cache by trading mode as well.
--
-- ccxt market DESCRIPTORS are byte-identical between Bitget's live and paper
-- venues (same id, precision, contractSize — verified), but AVAILABILITY is not:
-- demo lists ~51 markets against ~1950 live. Without the `sandbox` dimension a
-- cached live descriptor would make an instrument look tradable on demo when it
-- isn't, and the "not on the paper venue" fallback could never fire.
--
-- Safe as a NOT NULL add: `market_cache` is empty (introduced one migration ago
-- and only ever written by the not-yet-built cron).

-- DropIndex
DROP INDEX "market_cache_exchange_symbol_key";

-- AlterTable
ALTER TABLE "market_cache" ADD COLUMN     "sandbox" BOOLEAN NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "market_cache_exchange_symbol_sandbox_key" ON "market_cache"("exchange", "symbol", "sandbox");
