import "dotenv/config";
import { prisma } from "../lib/db";
/**
 * One-off: enforce the capital invariant on existing rows. For FIXED deployments,
 * allocatedCapital must equal capitalPerTrade (the pool IS the per-trade amount).
 * Idempotent — safe to run repeatedly. PERCENTAGE rows are left untouched (their
 * pool is a separate, user-set amount).
 */
async function main() {
  const fixed = await prisma.userBot.findMany({
    where: { allocationType: "FIXED" },
    select: { id: true, capitalPerTrade: true, allocatedCapital: true, bot: { select: { name: true } } },
  });
  let changed = 0;
  for (const ub of fixed) {
    if (ub.allocatedCapital === ub.capitalPerTrade) continue;
    await prisma.userBot.update({ where: { id: ub.id }, data: { allocatedCapital: ub.capitalPerTrade } });
    console.log(`  fixed "${ub.bot.name}": allocated ${ub.allocatedCapital} → ${ub.capitalPerTrade}`);
    changed++;
  }
  console.log(`\n${changed}/${fixed.length} FIXED deployments aligned (allocated = capitalPerTrade).`);
  const pctZero = await prisma.userBot.count({ where: { allocationType: "PERCENTAGE", allocatedCapital: { lte: 0 } } });
  if (pctZero) console.log(`Note: ${pctZero} PERCENTAGE deployment(s) still have a $0 pool — their owner must set Allocated Capital in Settings.`);
  await prisma.$disconnect();
}
main();
