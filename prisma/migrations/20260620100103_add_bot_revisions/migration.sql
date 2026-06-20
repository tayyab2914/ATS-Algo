-- CreateTable
CREATE TABLE "bot_revisions" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_revisions_botId_idx" ON "bot_revisions"("botId");

-- AddForeignKey
ALTER TABLE "bot_revisions" ADD CONSTRAINT "bot_revisions_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
