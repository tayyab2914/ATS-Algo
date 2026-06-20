-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- Seed the default categories (idempotent).
INSERT INTO "categories" ("id", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, v, now(), now()
FROM (VALUES ('Crypto'), ('Forex'), ('Commodities'), ('Stocks')) AS d(v)
ON CONFLICT ("name") DO NOTHING;

-- Seed any categories already used by existing bots (idempotent).
INSERT INTO "categories" ("id", "name", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, b.category, now(), now()
FROM (SELECT DISTINCT category FROM "bots" WHERE category IS NOT NULL AND category <> '') AS b
ON CONFLICT ("name") DO NOTHING;
