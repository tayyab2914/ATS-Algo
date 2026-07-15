-- Live-mark snapshot on an open position, refreshed each reconcile pass, so the member's
-- page can show unrealized PnL without an exchange call on every load. All nullable and
-- additive — safe to apply under load.
ALTER TABLE "positions" ADD COLUMN "lastMarkPrice" DOUBLE PRECISION;
ALTER TABLE "positions" ADD COLUMN "unrealizedPnl" DOUBLE PRECISION;
ALTER TABLE "positions" ADD COLUMN "markedAt" TIMESTAMP(3);
