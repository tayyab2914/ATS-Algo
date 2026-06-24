-- Guest Mode: trial deadline for signed-in, non-subscribed accounts. Null until
-- the trial clock starts on first login. Accounts are not deleted on expiry.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "guestExpiresAt" TIMESTAMP(3);
