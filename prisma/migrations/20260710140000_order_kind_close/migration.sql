-- Record the market order that flattens a position on an `exit` signal.
--
-- Realized PnL is booked from the venue's own fills, matched to the orders we
-- placed. Without a row for the closing order its fills are unattributable, and
-- compounding would grow the next trade off an incomplete number.

-- AlterEnum
ALTER TYPE "OrderKind" ADD VALUE 'CLOSE';
