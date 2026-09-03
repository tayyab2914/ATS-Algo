/**
 * Print an account's entitlement-relevant state (role/status/subscription/community),
 * so we know whether the member Account page is reachable for testing.
 *   CHECK_EMAIL="you@example.com" npx tsx scripts/account-status.ts
 */
import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  const email = (process.env.CHECK_EMAIL ?? "you@example.com").toLowerCase();
  const u = await prisma.user.findUnique({
    where: { email },
    include: {
      subscription: true,
      subscriptionRequest: true,
      communityLink: { select: { name: true, slug: true, active: true } },
    },
  });
  if (!u) {
    console.log(`No user found for ${email}`);
    return;
  }
  console.log(
    JSON.stringify(
      {
        email: u.email,
        role: u.role,
        status: u.status,
        emailVerified: Boolean(u.emailVerified),
        policyAccepted: Boolean(u.policyAcceptedAt),
        // Null means an individual sign-up: a read-only guest until an admin
        // makes them a member. A community sign-up is granted at registration.
        community: u.communityLink
          ? { name: u.communityLink.name, slug: u.communityLink.slug, linkActive: u.communityLink.active, joinedAt: u.communityJoinedAt }
          : null,
        subscription: u.subscription
          ? {
              currentPeriodEnd: u.subscription.currentPeriodEnd,
              // The whole entitlement rule, inlined so the output answers the
              // question without the reader having to date-compare by eye.
              active:
                u.subscription.currentPeriodEnd === null ||
                u.subscription.currentPeriodEnd > new Date(),
            }
          : null,
        accessRequest: u.subscriptionRequest
          ? {
              status: u.subscriptionRequest.status,
              requestedAt: u.subscriptionRequest.requestedAt,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error("Error:", e?.message ?? e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
