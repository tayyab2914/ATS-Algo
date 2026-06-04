import "dotenv/config";
import { prisma } from "../lib/db";

/**
 * List — and optionally delete — users who never confirmed their email address.
 *
 * An unverified account has `emailVerified === null`. Deleting a user cascades
 * to their verification tokens, reset tokens, exchange connections and 2FA codes
 * (see the `onDelete: Cascade` relations in schema.prisma), so nothing is left
 * orphaned.
 *
 * Usage:
 *   npx tsx scripts/unverified-users.ts                      list only (safe default)
 *   npx tsx scripts/unverified-users.ts --older-than=48      list those signed up >48h ago
 *   npx tsx scripts/unverified-users.ts --delete             delete (guard: only >24h old)
 *   npx tsx scripts/unverified-users.ts --delete --all-ages  delete every unverified user
 *   npx tsx scripts/unverified-users.ts --delete --include-admins  also delete ADMIN accounts
 *
 * The age guard means a brand-new signup who simply hasn't opened their inbox
 * yet is never deleted out from under them. ADMIN accounts are skipped on delete
 * unless --include-admins is passed, so you can't wipe yourself by accident.
 */

const args = process.argv.slice(2);
const doDelete = args.includes("--delete");
const allAges = args.includes("--all-ages");
const includeAdmins = args.includes("--include-admins");
const olderThanArg = args.find((a) => a.startsWith("--older-than="));
const olderThanHours = olderThanArg ? Number(olderThanArg.split("=")[1]) : 24;

const ageHours = (d: Date) => (Date.now() - d.getTime()) / 36e5;

async function main() {
  const cutoff = allAges ? null : new Date(Date.now() - olderThanHours * 36e5);

  const users = await prisma.user.findMany({
    where: {
      emailVerified: null,
      ...(cutoff ? { createdAt: { lt: cutoff } } : {}),
    },
    select: { id: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const scope = cutoff ? ` (signed up more than ${olderThanHours}h ago)` : " (any age)";

  if (users.length === 0) {
    console.log(`No unverified users${scope}.`);
    return;
  }

  console.log(`${users.length} unverified user(s)${scope}:`);
  for (const u of users) {
    console.log(`  ${u.email.padEnd(34)} ${u.role.padEnd(5)} signed up ${ageHours(u.createdAt).toFixed(1)}h ago`);
  }

  if (!doDelete) {
    console.log("\nList only — nothing deleted. Re-run with --delete to remove these accounts.");
    return;
  }

  const deletable = includeAdmins ? users : users.filter((u) => u.role !== "ADMIN");
  const skipped = users.length - deletable.length;
  if (skipped > 0) {
    console.log(`\nSkipping ${skipped} ADMIN account(s). Pass --include-admins to delete them too.`);
  }
  if (deletable.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const result = await prisma.user.deleteMany({ where: { id: { in: deletable.map((u) => u.id) } } });
  console.log(`\nDeleted ${result.count} user(s). Related tokens/connections were removed via cascade.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .then(() => process.exit(0));
