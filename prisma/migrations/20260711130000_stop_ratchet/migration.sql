-- Progressive stop-loss ratchet.
--
-- The stop used to be a one-shot: `beMoved` latched true the first (and only) time
-- it moved to break-even. The ratchet tightens once per FILLED take-profit rung and
-- may cross entry to LOCK PROFIT, so it needs a STEP, not a latch.
--
-- Purely additive. `beMoved` is kept (the dashboard reads it) and now means "the stop
-- is at or beyond entry" — which is what it always displayed anyway.

-- Ratchet generation the working stop is at. 0 = only the entry's attached preset.
ALTER TABLE "positions" ADD COLUMN "stopStep" INTEGER NOT NULL DEFAULT 0;

-- The profile the position ACTUALLY trades, frozen at open.
--
-- This closes a bug that predates the ratchet: the stop maths reads the LIVE bot
-- config, so an admin editing the bot — or its risk class — while a position is open
-- silently changes `sl`, `be`, even `tp[]` UNDERNEATH that open trade. Nullable
-- because rows written before this column exist; the engine falls back to the live
-- config for those, exactly as it does today.
ALTER TABLE "positions" ADD COLUMN "profileSnapshot" JSONB;

-- A position that already broke even is at generation 1. Without this, a deploy
-- mid-trade would try to re-place a stop that position is already carrying — and its
-- deterministic clientOid is already burned at the venue, so Bitget would reject it
-- with 40786 on every sync until the trade closed.
UPDATE "positions" SET "stopStep" = 1 WHERE "beMoved" = true AND "status" = 'OPEN';

-- One Order row per stop generation. Every STOP row that exists today is generation 0
-- — the preset placed with the entry. (On a position that already broke even, that row
-- holds the plan order's id, because the old code overwrote it: historically lossy, but
-- still OUR id and still attributable, so label it 0 and leave it alone.)
UPDATE "orders" SET "rungIndex" = 0 WHERE "kind" = 'STOP' AND "rungIndex" IS NULL;
