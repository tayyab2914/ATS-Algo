-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "tradingViewConnected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "walletAddress" TEXT,
ADD COLUMN     "walletConnected" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "exchange_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT 'Read & Trade',
    "apiKeyMasked" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_connections_userId_exchange_key" ON "exchange_connections"("userId", "exchange");

-- AddForeignKey
ALTER TABLE "exchange_connections" ADD CONSTRAINT "exchange_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
