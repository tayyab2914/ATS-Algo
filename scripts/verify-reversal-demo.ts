/**
 * End-to-end for the SWING-BOT reversal, against Bitget's PAPER engine only.
 *
 * Proves the one-way (no-hedge) rule: a new entry REPLACES the current position.
 *   1. ENTER LONG  → one open LONG position.
 *   2. ENTER SHORT → the LONG is auto-closed (reason REVERSAL) and a SHORT opens.
 *   3. Assert exactly ONE open position (the SHORT) — never two at once.
 *
 * ⚠ Shares the single Bitget demo account. It FLATTENS that account first, so do
 *   not run it while a demo position you care about is open.
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-reversal-demo.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import type { BotConfig } from "../lib/bot-config";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, type TradeCreds } from "../lib/execution/client";
import { fanOut } from "../lib/execution/dispatch";
import { closeAll } from "../lib/execution/execute";
import { resolveSymbol } from "../lib/execution/symbol";

const creds: TradeCreds = {
  apiKey: process.env.BITGET_DEMO_KEY!, apiSecret: process.env.BITGET_DEMO_SECRET!,
  passphrase: process.env.BITGET_DEMO_PASSPHRASE!, sandbox: true,
};

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

async function main() {
  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const stamp = Date.now();

  const { symbol, market } = await resolveSymbol("Bitget", "BTC", true);
  const ex = await exchangeClient("Bitget", creds, [market]);
  if (ex.options["sandboxMode"] !== true) throw new Error("REFUSING TO RUN: not sandbox");
  await closeAll(ex, symbol).catch(() => {}); // start flat

  const user = await prisma.user.create({ data: { email: `rev-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const aad = `${user.id}:Bitget`;
  await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "Bitget", sandbox: true, permissions: "Read & Trade", apiKeyMasked: "••••test",
      apiKeyEnc: encryptSecret(creds.apiKey, aad), apiSecretEnc: encryptSecret(creds.apiSecret, aad), passphraseEnc: encryptSecret(creds.passphrase!, aad) },
  });
  const bot = await prisma.bot.create({
    data: { name: `REV ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "MEDIUM", ticker: "BTC", exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 20, capitalPerTrade: 20, allocationType: "FIXED", exchangeSource: "Bitget" },
    select: { id: true },
  });

  const fire = async (side: "LONG" | "SHORT", ts: number) => {
    const price = Number((await ex.fetchTicker(symbol)).last);
    const s = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side, dedupeKey: String(ts), raw: { price } }, select: { id: true } });
    return fanOut(s.id);
  };

  try {
    console.log("── 1. ENTER LONG ──");
    const r1 = await fire("LONG", stamp);
    check("LONG entry placed", r1.placed.length === 1, JSON.stringify({ placed: r1.placed.length, skipped: r1.skipped, failed: r1.failed }));
    const afterLong = await prisma.position.findMany({ where: { userBotId: userBot.id, status: "OPEN" } });
    check("exactly one OPEN position, side LONG", afterLong.length === 1 && afterLong[0]?.side === "LONG", `open=${afterLong.length}`);
    const longId = afterLong[0]?.id;

    console.log("\n── 2. ENTER SHORT (reversal) ──");
    const r2 = await fire("SHORT", stamp + 1);
    check("SHORT entry placed (new position opened)", r2.placed.length === 1, JSON.stringify({ placed: r2.placed.length, skipped: r2.skipped, failed: r2.failed }));

    console.log("\n── 3. one-way / no-hedge assertions ──");
    const open = await prisma.position.findMany({ where: { userBotId: userBot.id, status: "OPEN" } });
    check("exactly ONE open position after reversal (never two)", open.length === 1, `open=${open.length}`);
    check("the surviving open position is SHORT", open[0]?.side === "SHORT", open[0]?.side ?? "none");
    const prior = longId ? await prisma.position.findUnique({ where: { id: longId }, select: { status: true, closedReason: true, realizedPnl: true } }) : null;
    check("the prior LONG is now CLOSED", prior?.status === "CLOSED", prior?.status ?? "missing");
    check("...closed with reason REVERSAL", prior?.closedReason === "REVERSAL", prior?.closedReason ?? "");
    const ub = await prisma.userBot.findUnique({ where: { id: userBot.id }, select: { realizedBalance: true } });
    console.log(`  realized from the reversed LONG: ${prior?.realizedPnl} · deployment realizedBalance: ${ub?.realizedBalance}`);
  } finally {
    console.log("\n── cleanup ──");
    await closeAll(ex, symbol).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } });
    console.log("  venue flattened · throwaway rows deleted");
  }

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => {}); process.exit(1); });
