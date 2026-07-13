-- Execution engine: persist inbound signals, the positions they open, every
-- order behind them, and an audit trail. Purely additive — new tables plus
-- nullable/defaulted columns on `bots` and `user_bots`.
--
-- Two unique indexes do the safety work:
--   signals(botId, action, ts)          -- a replayed TradingView alert is dropped
--   positions(userBotId, entrySignalId) -- a retried fan-out cannot double-open
--   orders(clientOrderId)               -- mirrors the `clientOid` sent to the venue

-- CreateEnum
CREATE TYPE "SignalAction" AS ENUM ('ENTER', 'EXIT', 'TP1', 'TP2', 'TP3', 'TP4', 'TP5', 'TP6', 'TP7', 'TP8', 'TP9', 'TP10');

-- CreateEnum
CREATE TYPE "PositionSide" AS ENUM ('LONG', 'SHORT');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('ENTRY', 'STOP', 'TP');

-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('PENDING', 'OPEN', 'FILLED', 'CANCELED', 'REJECTED');

-- AlterTable
ALTER TABLE "bots" ADD COLUMN     "signalKeyVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "signalSecretEnc" TEXT;

-- AlterTable
ALTER TABLE "user_bots" ADD COLUMN     "exchangePreparedAt" TIMESTAMP(3),
ADD COLUMN     "liveArmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "realizedBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "signals" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "action" "SignalAction" NOT NULL,
    "side" "PositionSide",
    "ts" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'tradingview',
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" TEXT NOT NULL,
    "userBotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entrySignalId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "sandbox" BOOLEAN NOT NULL,
    "side" "PositionSide" NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "leverage" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "marginUsed" DOUBLE PRECISION NOT NULL,
    "initialStopPrice" DOUBLE PRECISION NOT NULL,
    "currentStopPrice" DOUBLE PRECISION NOT NULL,
    "beMoved" BOOLEAN NOT NULL DEFAULT false,
    "tpRungsFilled" INTEGER NOT NULL DEFAULT 0,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "closedReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "kind" "OrderKind" NOT NULL,
    "state" "OrderState" NOT NULL DEFAULT 'PENDING',
    "exchangeOrderId" TEXT,
    "clientOrderId" TEXT NOT NULL,
    "rungIndex" INTEGER,
    "side" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "size" DOUBLE PRECISION NOT NULL,
    "filledSize" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgFillPrice" DOUBLE PRECISION,
    "reduceOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_logs" (
    "id" TEXT NOT NULL,
    "botId" TEXT,
    "userBotId" TEXT,
    "signalId" TEXT,
    "positionId" TEXT,
    "level" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_cache" (
    "id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signals_botId_createdAt_idx" ON "signals"("botId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "signals_botId_action_ts_key" ON "signals"("botId", "action", "ts");

-- CreateIndex
CREATE INDEX "positions_userBotId_status_idx" ON "positions"("userBotId", "status");

-- CreateIndex
CREATE INDEX "positions_status_idx" ON "positions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "positions_userBotId_entrySignalId_key" ON "positions"("userBotId", "entrySignalId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_clientOrderId_key" ON "orders"("clientOrderId");

-- CreateIndex
CREATE INDEX "orders_positionId_kind_idx" ON "orders"("positionId", "kind");

-- CreateIndex
CREATE INDEX "orders_exchangeOrderId_idx" ON "orders"("exchangeOrderId");

-- CreateIndex
CREATE INDEX "orders_state_idx" ON "orders"("state");

-- CreateIndex
CREATE INDEX "execution_logs_botId_createdAt_idx" ON "execution_logs"("botId", "createdAt");

-- CreateIndex
CREATE INDEX "execution_logs_userBotId_createdAt_idx" ON "execution_logs"("userBotId", "createdAt");

-- CreateIndex
CREATE INDEX "execution_logs_positionId_idx" ON "execution_logs"("positionId");

-- CreateIndex
CREATE UNIQUE INDEX "market_cache_exchange_symbol_key" ON "market_cache"("exchange", "symbol");

-- AddForeignKey
ALTER TABLE "signals" ADD CONSTRAINT "signals_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_userBotId_fkey" FOREIGN KEY ("userBotId") REFERENCES "user_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
