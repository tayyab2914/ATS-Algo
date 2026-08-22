-- Stripe is gone: access is granted by an admin, never purchased. `subscriptions`
-- reduces to what a grant actually needs — the row's existence plus an optional
-- end date.
--
-- Steps 1 and 2 are NOT optional bookkeeping. They translate today's entitlement
-- rule into tomorrow's, so that nobody silently gains or loses access at cutover:
--
--   TODAY   comp row  -> status = 'ACTIVE' AND (currentPeriodEnd IS NULL OR > now)
--           paid row  -> status IN ('ACTIVE','TRIALING')   -- currentPeriodEnd IGNORED
--   AFTER   any row   -> row exists  AND (currentPeriodEnd IS NULL OR > now)
--
-- The two rules disagree on exactly two row shapes, which is what steps 1 and 2
-- are for. Applying only the DROPs would both revoke live members and resurrect
-- cancelled ones.

-- 1. A paid subscriber holds access on `status` ALONE today, so a stale or past
--    `currentPeriodEnd` on their row would silently REVOKE them under the new
--    rule. Give them a real future end date: 30 days of grace, which an admin can
--    extend or revoke from Members Management. This is also the window in which
--    the live Stripe subscriptions get cancelled Stripe-side.
UPDATE "subscriptions"
   SET "currentPeriodEnd" = NOW() + INTERVAL '30 days'
 WHERE "isComp" = false
   AND "status" IN ('ACTIVE', 'TRIALING')
   AND "currentPeriodEnd" IS NOT NULL
   AND "currentPeriodEnd" <= NOW();

-- 2. Delete every row that grants NO access today. Without this the new rule
--    RESURRECTS them: Stripe writes a FUTURE `currentPeriodEnd` onto a
--    cancel-at-period-end row and leaves it there after cancellation, so a
--    CANCELED subscription would start granting access the instant `status`
--    stops being consulted. This is the single most dangerous row shape in the
--    table, and it is why this DELETE runs before the DROPs rather than after.
DELETE FROM "subscriptions"
 WHERE NOT (
        ("isComp" = true  AND "status" = 'ACTIVE' AND ("currentPeriodEnd" IS NULL OR "currentPeriodEnd" > NOW()))
     OR ("isComp" = false AND "status" IN ('ACTIVE', 'TRIALING'))
 );

-- 3. Drop the Stripe mirror. The unique indexes users_stripeCustomerId_key and
--    subscriptions_stripeSubscriptionId_key are dropped with their columns.
-- AlterTable
ALTER TABLE "users" DROP COLUMN "stripeCustomerId";

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "stripeSubscriptionId",
                            DROP COLUMN "stripePriceId",
                            DROP COLUMN "plan",
                            DROP COLUMN "status",
                            DROP COLUMN "cancelAtPeriodEnd",
                            DROP COLUMN "isComp";

-- 4. The enums die with their last column. Order matters: a type cannot be
--    dropped while a column still references it, so this must follow step 3.
-- DropEnum
DROP TYPE "BillingPlan";

-- DropEnum
DROP TYPE "SubscriptionStatus";
