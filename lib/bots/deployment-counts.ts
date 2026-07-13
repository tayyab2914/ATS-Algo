import { prisma } from "@/lib/db";

/**
 * How many members have deployed each bot, and how many are running it.
 *
 * Two different facts, and the difference matters: a member can add a bot to My
 * Bots without ever switching it on. `users` is adoption; `running` is what is
 * actually trading.
 *
 * One grouped query for the whole table rather than a count per row.
 */
export type DeploymentCount = { users: number; running: number };

export async function deploymentCounts(): Promise<Map<string, DeploymentCount>> {
  const grouped = await prisma.userBot.groupBy({
    by: ["botId", "active"],
    _count: { _all: true },
  });

  const counts = new Map<string, DeploymentCount>();
  for (const row of grouped) {
    const entry = counts.get(row.botId) ?? { users: 0, running: 0 };
    entry.users += row._count._all;
    if (row.active) entry.running += row._count._all;
    counts.set(row.botId, entry);
  }
  return counts;
}

export const countFor = (counts: Map<string, DeploymentCount>, botId: string): DeploymentCount =>
  counts.get(botId) ?? { users: 0, running: 0 };
