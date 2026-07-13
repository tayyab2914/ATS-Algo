/**
 * Print an account's entitlement-relevant state (role/status/subscription/guest),
 * so we know whether the member Account page is reachable for testing.
 *   CHECK_EMAIL="you@example.com" npx tsx scripts/account-status.ts
 */
import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  const email = (process.env.CHECK_EMAIL ?? "you@example.com").toLowerCase();
  const u = await prisma.user.findUnique({ where: { email }, include: { subscription: true } });
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
        guestExpiresAt: u.guestExpiresAt,
        subscription: u.subscription
          ? {
              status: u.subscription.status,
              isComp: u.subscription.isComp,
              plan: u.subscription.plan,
              currentPeriodEnd: u.subscription.currentPeriodEnd,
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
