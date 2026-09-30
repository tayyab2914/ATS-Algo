-- Realized PnL that is not final yet.
--
-- A venue publishes a fill a beat after it executes, and settle reads the fills
-- seconds after sending the close — so the closing leg is routinely still missing
-- when PnL is first worked out. The close itself can never wait (a reversal
-- refuses to open on top of a row still marked OPEN), so the NUMBER is deferred
-- instead: `realizedPnl` holds the venue's figure for the fills we could see, and
-- the re-settlement pass applies the difference once the rest arrive.
--
-- Additive and defaulted, so every existing row reads exactly as it does today.
ALTER TABLE "positions" ADD COLUMN "pnlPending" BOOLEAN NOT NULL DEFAULT false;

-- The pass reads exactly these rows, once a minute, and they are almost always none.
CREATE INDEX "positions_pnlPending_idx" ON "positions"("pnlPending");
