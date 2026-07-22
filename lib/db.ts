import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Prisma client singleton.
 *
 * Prisma 7 ships without the Rust query engine, so it connects through a driver
 * adapter — `@prisma/adapter-pg` straight to RDS Postgres.
 *
 * There is no connection pooler in front of the database and none is needed.
 * The old Supabase setup required one because serverless meant many short-lived
 * clients competing for ~15 session connections; here a single long-lived
 * server owns exactly one pg pool for the life of the process. `DATABASE_URL`
 * and `DIRECT_URL` are therefore the same endpoint — the split only survives
 * because `prisma.config.ts` wants a migration URL.
 *
 * `max` caps how many upstream connections this process opens. db.t4g.micro
 * allows ~112, so the deployed value of 10 (deploy/README.md) leaves ample
 * headroom for migrations and `prisma studio` alongside; the default of 5 is
 * only the dev fallback. The client is cached on `globalThis` so dev HMR reuses
 * one pool.
 *
 * The instance sits in the same AZ as the app with no public endpoint, so a
 * query round-trip is well under a millisecond and reachable only from the
 * app's security group.
 */
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 5);

const createPrismaClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: POOL_MAX }),
  });

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Reuse a single client/pool across HMR reloads and repeated module evaluation.
globalForPrisma.prisma = prisma;
