/**
 * The live-mark snapshot: syncPosition persists the venue's mark + unrealized PnL onto an
 * OPEN position each pass, and loadLiveView surfaces it — so the member's page shows
 * unrealized PnL with no exchange call of its own. Proven against Bitget's PAPER engine.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-live-mark-demo.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { profileFor, snapshotProfile, type BotConfig } from "../lib/bot-config";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, type TradeCreds } from "../lib/execution/client";
import { closeAll, openPosition } from "../lib/execution/execute";
import { syncPosition } from "../lib/execution/manage";
import { resolveSymbol } from "../lib/execution/symbol";
import { loadLiveView } from "../lib/my-bots/live-view";

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
  const profile = profileFor(config, "LOW")!;
  const stamp = Date.now();

  const { symbol, market, requested } = await resolveSymbol("Bitget", "BTC", true);
  const ex = await exchangeClient("Bitget", creds, [market]);
  if (ex.options["sandboxMode"] !== true) throw new Error("REFUSING TO RUN: not sandbox");
  await closeAll(ex, symbol).catch(() => {});

  const user = await prisma.user.create({ data: { email: `mark-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const aad = `${user.id}:Bitget`;
  await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "Bitget", sandbox: true, permissions: "Read & Trade", apiKeyMasked: "••••test",
      apiKeyEnc: encryptSecret(creds.apiKey, aad), apiSecretEnc: encryptSecret(creds.apiSecret, aad), passphraseEnc: encryptSecret(creds.passphrase!, aad) },
  });
  const bot = await prisma.bot.create({
    data: { name: `MARK ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC",
      exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 30, allocationType: "FIXED", exchangeSource: "Bitget" },
    select: { id: true },
  });

  try {
    const signal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", ts: String(stamp), raw: {} }, select: { id: true } });
    const priceHint = Number((await ex.fetchTicker(symbol)).last);
    const opened = await openPosition({
      signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: "Bitget", creds, symbol, market,
      requestedSymbol: requested, substituted: false, side: "LONG", profile, snapshot: snapshotProfile(config, profile),
      sizing: { allocationType: "FIXED", capitalPerTrade: 30, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
    console.log(`  opened ${opened.size} @ ${opened.entryPrice}`);

    // Before any sync: no snapshot yet.
    const before = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { markedAt: true, unrealizedPnl: true } });
    check("no live-mark snapshot before the first sync", before?.markedAt === null && before?.unrealizedPnl === null);

    // The 1-minute cron does exactly this.
    const synced = await syncPosition(opened.positionId);
    check("position still open after sync (not closed)", synced.closed === false);

    const after = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { markedAt: true, unrealizedPnl: true, lastMarkPrice: true } });
    check("sync persisted a mark price", (after?.lastMarkPrice ?? 0) > 0, `mark=${after?.lastMarkPrice}`);
    check("sync persisted an unrealized PnL", after?.unrealizedPnl != null, `upnl=${after?.unrealizedPnl?.toFixed(4)}`);
    check("sync stamped markedAt", after?.markedAt != null);
    // A freshly-opened position sits within a few ticks of entry — the unrealized PnL is small.
    check("unrealized PnL is sane (small, near entry)", Math.abs(after?.unrealizedPnl ?? 999) < 20, `upnl=${after?.unrealizedPnl?.toFixed(4)}`);

    // The member page reads it straight from loadLiveView — no exchange call.
    const view = await loadLiveView(userBot.id, config, "LOW");
    check("loadLiveView surfaces an open position", view.open !== null);
    check("…with the mark price", view.open?.markPrice != null && view.open.markPrice > 0, `mark=${view.open?.markPrice}`);
    check("…with the unrealized PnL", view.open?.unrealizedPnl != null, `upnl=${view.open?.unrealizedPnl?.toFixed(4)}`);
    check("…and a markedAt timestamp", view.open?.markedAt != null);
    console.log(`  view: mark=${view.open?.markPrice} upnl=${view.open?.unrealizedPnl?.toFixed(4)} at=${view.open?.markedAt?.toISOString()}`);
  } finally {
    console.log("\n── cleanup ──");
    await closeAll(ex, symbol).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.executionLog.deleteMany({ where: { botId: bot.id } }).catch(() => {});
    await prisma.bot.delete({ where: { id: bot.id } }).catch(() => {});
    console.log("  venue flattened · throwaway rows deleted");
  }

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => {}); process.exit(1); });
