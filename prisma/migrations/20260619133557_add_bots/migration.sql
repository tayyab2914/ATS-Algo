-- CreateEnum
CREATE TYPE "RiskClass" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ticker" TEXT,
    "category" TEXT NOT NULL,
    "assetType" TEXT,
    "exchange" TEXT,
    "timeframe" TEXT NOT NULL,
    "riskClass" "RiskClass" NOT NULL DEFAULT 'MEDIUM',
    "status" "BotStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB NOT NULL,
    "csvFilename" TEXT,
    "csvData" TEXT,
    "trades" INTEGER NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profitFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgTrade" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "d30" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "d90" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "d180" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "d360" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bots_status_idx" ON "bots"("status");
