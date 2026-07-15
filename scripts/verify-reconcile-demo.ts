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
import { profileFor, snapshotProfile } from "../lib/bot-config";
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
  // The rules the position freezes at open — the engine reads these, never the live config.
  const snapshot = snapshotProfile(config, profile);
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
      requestedSymbol: requested, substituted: false, side: "LONG", profile, snapshot,
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
    // >= 1, not === 1: BTC can genuinely fill another rung (the nearest is only 0.3% away)
    // while the test runs. The point is that the FORCED fill was seen, not that the
    // market stood still.
    check("reconcile counted the filled rung", synced.rungsFilled >= 1, `rungsFilled=${synced.rungsFilled}`);
    check("and moved the stop", synced.stopMoved === true);
    check("position not closed (still holding)", synced.closed === false);
    const afterBe = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { beMoved: true, currentStopPrice: true, entryPrice: true } });
    check("stop recorded at the entry", afterBe?.beMoved === true && Math.abs(afterBe.currentStopPrice - afterBe.entryPrice) < 1);
    // The movable stop is a pos_loss (position-family), not a {trigger:true} normal_plan — a
    // reduce-only plan stop is starved by the reduce-only TP ladder and never fires.
    check("a working stop exists on the venue", (await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" })).filter((o) => (o.info as { planType?: string } | undefined)?.planType === "pos_loss").length === 1);

    console.log("\n── the silent close: exactly what a stop firing looks like ──");
    // Close it on the exchange without telling our database. No webhook. No alert.
    const flat = await closeAll(ex, symbol);
    check("position gone from the venue", flat.flattened && Number((await ex.fetchPositions([symbol]))[0]?.contracts ?? 0) === 0);
    check("but our database still says OPEN", (await prisma.position.findUnique({ where: { id: opened.positionId }, select: { status: true } }))?.status === "OPEN");

    // NOTE: the bot no longer "silently dies" here — the swing-bot reversal means the
    // NEXT entry closes a stale row and opens fresh. So reconcile must be proven on the
    // case it actually exists for: a position that ends with NO following signal (a stop
    // firing on a bot that then sits flat for hours). We call reconcile FIRST, with no
    // new signal, which is exactly that case.
    console.log("\n── reconcile notices, settles, and books the PnL ──");
    const pass = await reconcileOpenPositions();
    check("reconcile scanned and closed it", pass.closed === 1, JSON.stringify(pass));
    const settled = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { status: true, realizedPnl: true, closedReason: true } });
    check("position CLOSED", settled?.status === "CLOSED", `reason=${settled?.closedReason}`);
    // This close came from outside our system, so its fill matches no order id we
    // recorded. Matching alone would have seen only the entry and booked roughly
    // -entryValue (~-77 here) into realizedBalance, and compounded the next trade
    // off it. The guard notices the position wasn't accounted for and widens.
    check("attribution guard fired (the closing fill was ours to nobody)", (await prisma.executionLog.findFirst({ where: { positionId: opened.positionId, event: "pnl.attributionIncomplete" } })) !== null);
    // The assertion that matters is MAGNITUDE, not sign: matching alone would have booked
    // roughly -entryValue (~-76) and compounded the next trade off it. A real rung filling
    // mid-test can leave the round trip slightly positive — that is fine and not the point.
    check("realized PnL is fees-sized, not entry-notional-sized", Math.abs(settled?.realizedPnl ?? 999) < 5, `pnl=${settled?.realizedPnl?.toFixed(4)} (matched-only would be ≈ -${(opened.size * opened.entryPrice).toFixed(0)})`);
    const ub = await prisma.userBot.findUnique({ where: { id: userBot.id }, select: { realizedBalance: true } });
    check("realizedBalance updated (this is what compounding sizes from)", Math.abs((ub?.realizedBalance ?? 0) - (settled?.realizedPnl ?? 0)) < 1e-9, `balance=${ub?.realizedBalance.toFixed(4)}`);

    const signal3 = await mkSignal(stamp + 2, Number((await ex.fetchTicker(symbol)).last));
    const recovered = await fanOut(signal3.id);
    check("the bot trades again", recovered.placed.length === 1, JSON.stringify({ placed: recovered.placed.length, skipped: recovered.skipped }));

    // The second safety net, added with the swing-bot reversal: even if reconcile never
    // ran, a stale OPEN row can no longer wedge the bot. A new entry CLOSES it (REVERSAL)
    // and opens fresh — where it used to be skipped as `positionAlreadyOpen` forever.
    console.log("\n── belt AND braces: a new entry self-heals a stale row, without reconcile ──");
    const stale = await prisma.position.findFirst({ where: { userBotId: userBot.id, status: "OPEN" }, select: { id: true } });
    await closeAll(ex, symbol); // silent close again — venue flat, our row still OPEN
    check("the row is stale again (venue flat, DB says OPEN)", stale !== null && Number((await ex.fetchPositions([symbol]))[0]?.contracts ?? 0) === 0);
    const healed = await fanOut((await mkSignal(stamp + 3, Number((await ex.fetchTicker(symbol)).last))).id);
    check("the entry was NOT skipped — it placed", healed.placed.length === 1, JSON.stringify({ placed: healed.placed.length, skipped: healed.skipped }));
    const staleNow = stale ? await prisma.position.findUnique({ where: { id: stale.id }, select: { status: true, closedReason: true } }) : null;
    check("…and the stale row was closed as REVERSAL", staleNow?.status === "CLOSED" && staleNow.closedReason === "REVERSAL", `${staleNow?.status}/${staleNow?.closedReason}`);
    check("exactly one OPEN position remains (no hedge)", (await prisma.position.count({ where: { userBotId: userBot.id, status: "OPEN" } })) === 1);

    console.log("\n── orphan: a position on the venue with no row ──");
    // Exactly what a crash between createOrder and the database write leaves behind.
    await prisma.position.deleteMany({ where: { userBotId: userBot.id, status: "OPEN" } });
    check("no open row, but the venue still holds contracts", Number((await ex.fetchPositions([symbol]))[0]?.contracts ?? 0) > 0);
    const orphans = await scanForOrphans();
    // `>= 1`, not `=== 1`: every deployment pointing at this same demo key + symbol sees
    // the same orphaned contracts, and the shared demo account has real deployments on it.
    // On production each member holds their own exchange account, so the count is 1 there.
    check("scanForOrphans found it", orphans.orphans >= 1, JSON.stringify(orphans));
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
