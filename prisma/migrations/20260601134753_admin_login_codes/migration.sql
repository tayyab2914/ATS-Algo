-- CreateTable
CREATE TABLE "admin_login_codes" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_login_codes_pkey" PRIMARY KEY ("id")
);
