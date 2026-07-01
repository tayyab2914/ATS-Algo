-- CreateEnum
CREATE TYPE "AllocationType" AS ENUM ('FIXED', 'PERCENTAGE');

-- AlterTable
ALTER TABLE "user_bots" ADD COLUMN     "allocationType" "AllocationType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "capitalPerTrade" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "compounding" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "exchangeSource" TEXT;
