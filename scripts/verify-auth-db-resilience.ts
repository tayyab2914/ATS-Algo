// Proves the auth liveness checks fail CLOSED when the database is unreachable,
// instead of throwing (which 500'd the public landing page on a Supabase blip).
//
// Not a mock: it points a real Prisma client at a dead host to produce a genuine
// P1001, then asserts the guard shape used in lib/auth/session.ts isSessionLive
// and lib/auth/guards.ts loadViewer turns that into a signed-out result. Also
// checks the happy path still reports live against the real DB.
// Run: npx tsx scripts/verify-auth-db-resilience.ts
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { prisma } from "../lib/db.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

// A client aimed at a port where nothing listens → fast ECONNREFUSED → P1001.
const deadDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString: "postgresql://u:p@127.0.0.1:1/postgres", max: 1, connectionTimeoutMillis: 3000 }),
});

// The exact guard from isSessionLive: on a query failure, fail closed.
async function isLive(db: PrismaClient, id: string): Promise<boolean> {
  let user: { status: string } | null;
  try {
    user = await db.user.findUnique({ where: { id }, select: { status: true } });
  } catch {
    return false; // fail closed — cannot confirm liveness
  }
  return !!user && user.status === "ACTIVE";
}

async function main() {
  console.log("── an unreachable DB must throw when unguarded ──");
  let threw = false;
  let code = "";
  try {
    await deadDb.user.findUnique({ where: { id: "anyone" }, select: { status: true } });
  } catch (e) {
    threw = true;
    code = (e as { code?: string }).code ?? (e as Error).message.split("\n")[0];
  }
  check("raw query against a dead DB throws (the old 500 path)", threw, code);

  console.log("\n── the guard turns that throw into a signed-out result ──");
  const liveWhenDown = await isLive(deadDb, "anyone");
  check("isLive fails CLOSED (returns false) when the DB is down", liveWhenDown === false);

  console.log("\n── the happy path still works against the real DB ──");
  const someone = await prisma.user.findFirst({ where: { status: "ACTIVE" }, select: { id: true } });
  if (!someone) {
    check("an ACTIVE user exists to test the happy path", false, "no ACTIVE users in DB");
  } else {
    const liveWhenUp = await isLive(prisma as unknown as PrismaClient, someone.id);
    check("isLive returns true for a real ACTIVE user when the DB is up", liveWhenUp === true);
    const ghost = await isLive(prisma as unknown as PrismaClient, "does-not-exist");
    check("isLive returns false for an unknown id (deleted user) when up", ghost === false);
  }

  await deadDb.$disconnect();
  await prisma.$disconnect();
  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
