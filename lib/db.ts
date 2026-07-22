import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Prisma client singleton.
 *
 * Prisma 7 ships without the Rust query engine, so it connects through a driver
 * adapter — `@prisma/adapter-pg` over Supabase's Supavisor pooler.
 *
 * IMPORTANT: `DATABASE_URL` must point at the TRANSACTION pooler (port 6543),
 * NOT the session pooler (5432). Session mode hands each client its own Postgres
 * connection for the whole session and caps the project at ~15, which a pool of
 * any size plus `prisma studio` plus a migration can exhaust — surfacing as
 * `(EMAXCONNSESSION) max clients reached in session mode ... pool_size: 15` and
 * making pages fail to load. Transaction mode multiplexes many clients over
 * those connections, releasing one back after each query. Migrations keep using
 * the direct `DIRECT_URL` (session/direct), configured in `prisma.config.ts`.
 *
 * `max` caps how many upstream connections this process opens. One long-lived
 * server owns exactly one pool, so this can be generous — 10 is the deployed
 * value (deploy/README.md); the default of 5 is only the dev fallback. The
 * client is cached on `globalThis` so dev HMR reuses one pool.
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
