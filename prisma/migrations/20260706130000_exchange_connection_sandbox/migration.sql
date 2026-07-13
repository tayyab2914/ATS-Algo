-- Whether a stored exchange key is a DEMO/paper (sandbox) key vs a live one.
-- Detected at connect time and used to route execution to the paper engine.
ALTER TABLE "exchange_connections"
  ADD COLUMN "sandbox" BOOLEAN NOT NULL DEFAULT false;
