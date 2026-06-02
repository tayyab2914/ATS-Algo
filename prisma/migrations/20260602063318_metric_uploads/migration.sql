-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "metric_uploads" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_uploads_pkey" PRIMARY KEY ("id")
);
