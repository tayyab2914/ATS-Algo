-- Community Access Links ("reflinks").
--
-- The platform is closing to individual sign-ups: from here on, a person who
-- registers at /signup is a read-only GUEST until an admin makes them a Member,
-- and the way a whole community gets in is one link rather than N approvals.
--
-- The 3-day Guest Mode trial is retired with it. It only ever existed to give an
-- individual a taste before paying, and there is nothing to pay for now — a guest
-- is simply read-only for as long as they remain one, which is why
-- `users.guestExpiresAt` is dropped rather than left behind to rot.

-- CreateTable
CREATE TABLE "community_links" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- One row per visitor per day, not per page load: the unique index below is what
-- makes "Clicks" a number a community can be judged on.
CREATE TABLE "community_link_clicks" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_link_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_links_slug_key" ON "community_links"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "community_link_clicks_linkId_day_visitorHash_key" ON "community_link_clicks"("linkId", "day", "visitorHash");

-- CreateIndex
CREATE INDEX "community_link_clicks_linkId_createdAt_idx" ON "community_link_clicks"("linkId", "createdAt");

-- AddForeignKey
ALTER TABLE "community_link_clicks" ADD CONSTRAINT "community_link_clicks_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "community_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: attribute each account to the community it joined through.
ALTER TABLE "users" ADD COLUMN "communityLinkId" TEXT;
ALTER TABLE "users" ADD COLUMN "communityJoinedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "users_communityLinkId_idx" ON "users"("communityLinkId");

-- AddForeignKey
-- SET NULL, not CASCADE: deleting a link must never delete the people who joined
-- through it. It costs the attribution and nothing else — their access is a
-- `subscriptions` row that this column has no say over.
ALTER TABLE "users" ADD CONSTRAINT "users_communityLinkId_fkey" FOREIGN KEY ("communityLinkId") REFERENCES "community_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropColumn: the Guest Mode trial clock is retired (see the header).
ALTER TABLE "users" DROP COLUMN "guestExpiresAt";
