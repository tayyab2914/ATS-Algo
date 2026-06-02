-- AlterTable
ALTER TABLE "users" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "two_factor_codes" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "two_factor_codes_userId_idx" ON "two_factor_codes"("userId");

-- AddForeignKey
ALTER TABLE "two_factor_codes" ADD CONSTRAINT "two_factor_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
