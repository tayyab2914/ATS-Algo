import "dotenv/config";
import { prisma } from "../lib/db";
async function main() {
  const botId = "cmqoxvsvp000eswnd3gmoj2a7";
  const signals = await prisma.signal.findMany({
    where: { botId },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { action: true, side: true, source: true, createdAt: true, raw: true },
  });
  if (!signals.length) { console.log("no signals for this bot"); await prisma.$disconnect(); return; }
  console.log("Recent signals for this bot (newest first):\n");
  for (const s of signals) {
    const raw = s.raw as Record<string, unknown> | null;
    const via = s.source === "admin" ? "ADMIN BUTTON (manual)" : s.source === "tradingview" ? "TRADINGVIEW webhook" : s.source;
    console.log(`  ${s.action}${s.side ? " " + s.side : ""}  ·  source: ${via}  ·  ${s.createdAt.toISOString()}`);
    if (raw && raw.admin) console.log(`      (fired by admin user ${String(raw.admin).slice(0, 8)}…)`);
  }
  await prisma.$disconnect();
}
main();
