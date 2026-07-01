-- CreateTable
CREATE TABLE "user_bots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "allocatedCapital" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_bots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_bots_userId_idx" ON "user_bots"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_bots_userId_botId_key" ON "user_bots"("userId", "botId");

-- AddForeignKey
ALTER TABLE "user_bots" ADD CONSTRAINT "user_bots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bots" ADD CONSTRAINT "user_bots_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
