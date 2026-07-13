/**
 * End-to-end for reconciliation, against Bitget's PAPER engine only.
 *
 * Demonstrates the failure it exists to prevent:
 *   1. a position is closed on the exchange with NO webhook (a stop firing looks
 *      exactly like this),
 *   2. our database still says OPEN, so the next entry is skipped forever and the
 *      member's bot silently dies,
 *   3. reconcile notices, books the PnL, and the bot trades again.
 *
 * Also covers break-even arming from a fill, and orphan detection.
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-reconcile-demo.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import type { BotConfig } from "../lib/bot-config";
import { profileFor } from "../lib/bot-config";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, type TradeCreds } from "../lib/execution/client";
import { fanOut } from "../lib/execution/dispatch";
import { closeAll, openPosition } from "../lib/execution/execute";
import { syncPosition } from "../lib/execution/manage";
import { reconcileOpenPositions, scanForOrphans } from "../lib/execution/reconcile";
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
  const profile = profileFor(config, "LOW")!; // safe: be = 1 → rung index 0
  const stamp = Date.now();

  const user = await prisma.user.create({ data: { email: `rec-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const aad = `${user.id}:Bitget`;
  await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "Bitget", sandbox: true, permissions: "Read & Trade", apiKeyMasked: "••••test",
      apiKeyEnc: encryptSecret(creds.apiKey, aad), apiSecretEnc: encryptSecret(creds.apiSecret, aad), passphraseEnc: encryptSecret(creds.passphrase!, aad) },
  });
  const bot = await prisma.bot.create({
    data: { name: `REC ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 20, allocationType: "FIXED", exchangeSource: "Bitget" },
    select: { id: true },
  });

  const mkSignal = async (ts: number, price: number) =>
    prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", ts: String(ts), raw: { price } }, select: { id: true } });

  const { symbol, market, requested } = await resolveSymbol("Bitget", "BTC", true);
  const ex = await exchangeClient("Bitget", creds, [market]);
  if (ex.options["sandboxMode"] !== true) throw new Error("REFUSING TO RUN: not sandbox");

  try {
    const priceHint = Number((await ex.fetchTicker(symbol)).last);
    const signal1 = await mkSignal(stamp, priceHint);
    const opened = await openPosition({
      signalId: signal1.id, userBotId: userBot.id, userId: user.id, exchange: "Bitget", creds, symbol, market,
      requestedSymbol: requested, substituted: false, side: "LONG", profile,
      sizing: { allocationType: "FIXED", capitalPerTrade: 20, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
    console.log(`  opened ${opened.size} @ ${opened.entryPrice}, ${opened.rungsPlaced} rungs`);

    console.log("\n── break-even arms from a FILL, not from a tp alert ──");
    // Simulate the be-rung (index 0) having filled, and price beyond the entry.
    const mark = Number((await ex.fetchTicker(symbol)).last);
    await prisma.order.updateMany({ where: { positionId: opened.positionId, kind: "TP", rungIndex: 0 }, data: { state: "FILLED", filledSize: 1 } });
    await prisma.position.update({ where: { id: opened.positionId }, data: { entryPrice: Number(ex.priceToPrecision(symbol, mark * 0.995)) } });

    const synced = await syncPosition(opened.positionId);
    check("reconcile counted the filled rung", synced.rungsFilled === 1, `rungsFilled=${synced.rungsFilled}`);
    check("and armed break-even", synced.beArmed === true);
    check("position not closed (still holding)", synced.closed === false);
    const afterBe = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { beMoved: true, currentStopPrice: true, entryPrice: true } });
    check("stop recorded at the entry", afterBe?.beMoved === true && Math.abs(afterBe.currentStopPrice - afterBe.entryPrice) < 1);
    check("a working stop exists on the venue", (await ex.fetchOpenOrders(symbol, undefined, undefined, { trigger: true })).length === 1);

    console.log("\n── the silent close: exactly what a stop firing looks like ──");
    // Close it on the exchange without telling our database. No webhook. No alert.
    const flat = await closeAll(ex, symbol);
    check("position gone from the venue", flat.flattened && Number((await ex.fetchPositions([symbol]))[0]?.contracts ?? 0) === 0);
    check("but our database still says OPEN", (await prisma.position.findUnique({ where: { id: opened.positionId }, select: { status: true } }))?.status === "OPEN");

    console.log("\n── …and that is why the bot would silently die ──");
    const signal2 = await mkSignal(stamp + 1, priceHint);
    const blocked = await fanOut(signal2.id);
    check("the next entry is SKIPPED as positionAlreadyOpen", blocked.skipped.some((s) => s.reason === "positionAlreadyOpen"), JSON.stringify(blocked.skipped));
    check("no new position was opened", (await prisma.position.count({ where: { userBotId: userBot.id } })) === 1);

    console.log("\n── reconcile notices, settles, and unblocks ──");
    const pass = await reconcileOpenPositions();
    check("reconcile scanned and closed it", pass.closed === 1, JSON.stringify(pass));
    const settled = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { status: true, realizedPnl: true, closedReason: true } });
    check("position CLOSED", settled?.status === "CLOSED", `reason=${settled?.closedReason}`);
    // This close came from outside our system, so its fill matches no order id we
    // recorded. Matching alone would have seen only the entry and booked roughly
    // -entryValue (~-77 here) into realizedBalance, and compounded the next trade
    // off it. The guard notices the position wasn't accounted for and widens.
    check("attribution guard fired (the closing fill was ours to nobody)", (await prisma.executionLog.findFirst({ where: { positionId: opened.positionId, event: "pnl.attributionIncomplete" } })) !== null);
    check("realized PnL is fees-sized, not entry-notional-sized", (settled?.realizedPnl ?? 0) < 0 && (settled?.realizedPnl ?? -999) > -5, `pnl=${settled?.realizedPnl.toFixed(4)} (matched-only would be ≈ -${(opened.size * opened.entryPrice).toFixed(0)})`);
    const ub = await prisma.userBot.findUnique({ where: { id: userBot.id }, select: { realizedBalance: true } });
    check("realizedBalance updated (this is what compounding sizes from)", Math.abs((ub?.realizedBalance ?? 0) - (settled?.realizedPnl ?? 0)) < 1e-9, `balance=${ub?.realizedBalance.toFixed(4)}`);

    const signal3 = await mkSignal(stamp + 2, Number((await ex.fetchTicker(symbol)).last));
    const recovered = await fanOut(signal3.id);
    check("the bot trades again", recovered.placed.length === 1, JSON.stringify({ placed: recovered.placed.length, skipped: recovered.skipped }));

    console.log("\n── orphan: a position on the venue with no row ──");
    // Exactly what a crash between createOrder and the database write leaves behind.
    await prisma.position.deleteMany({ where: { userBotId: userBot.id, status: "OPEN" } });
    check("no open row, but the venue still holds contracts", Number((await ex.fetchPositions([symbol]))[0]?.contracts ?? 0) > 0);
    const orphans = await scanForOrphans();
    check("scanForOrphans found it", orphans.orphans === 1, JSON.stringify(orphans));
    check("…and reported it rather than closing it", (await prisma.executionLog.findFirst({ where: { userBotId: userBot.id, event: "reconcile.orphan" } })) !== null);
  } finally {
    console.log("\n── cleanup ──");
    try {
      const result = await closeAll(ex, symbol);
      console.log(`  venue flattened (${result.contracts} contracts)`);
    } catch (e) { console.log(`  venue cleanup failed: ${e instanceof Error ? e.message : String(e)}`); }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.executionLog.deleteMany({ where: { botId: bot.id } }).catch(() => {});
    await prisma.bot.delete({ where: { id: bot.id } }).catch(() => {});
    console.log("  temp user + bot deleted");
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("\nERROR:", e); await prisma.$disconnect(); process.exit(1); });
