-- Scope one-time admin codes to the address they were sent to. Codes are
-- short-lived, so clear any in-flight ones before adding the NOT NULL column.
DELETE FROM "admin_login_codes";

-- AlterTable
ALTER TABLE "admin_login_codes" ADD COLUMN     "email" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "admin_login_codes_email_idx" ON "admin_login_codes"("email");
