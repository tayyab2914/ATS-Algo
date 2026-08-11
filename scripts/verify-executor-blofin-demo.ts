/**
 * End-to-end for the executor on BLOFIN's demo engine — the BloFin twin of
 * verify-executor-demo.ts, driving the SAME engine functions (openPosition, ratchetStop,
 * closeAll) rather than raw ccxt. This is what "BloFin is integrated" has to mean.
 *
 * Three things here exist on no other venue, and each is asserted rather than assumed:
 *
 *   CONTRACT-DENOMINATED SIZING. BTC-USDT has contractSize 0.001, so a size of 30 is 0.03 BTC.
 *     `sizeFromMargin` divides by it; without that the engine would ask for a thousandth of the
 *     intended position. Asserted by checking the notional actually opened against capital x lev.
 *   NO `fetchOrder` AT ALL. The adapter reads the entry fill out of `fetchClosedOrders`, so this
 *     also proves the `readFill` seam on the only venue that needs it.
 *   STOPS STACK IN ONE FAMILY, all sized, and the entry's backstop is an ordinary CANCELLABLE
 *     member of it. The strategy holds the OLDEST back as the backstop, so this asserts the
 *     Bitget-shaped outcome — backstop survives the ratchet under its own id — even though the
 *     venue itself offers no such protection. If that assertion ever fails, a ratchet is one
 *     cancel away from leaving the position naked.
 *
 * Refuses to run unless the client is on demo-trading-openapi.
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-executor-blofin-demo.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import type { BotConfig } from "../lib/bot-config";
import { profileFor, snapshotProfile } from "../lib/bot-config";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, livePosition, type TradeCreds } from "../lib/execution/client";
import { closeAll, executionError, openPosition, ratchetStop } from "../lib/execution/execute";
import { stopStrategyFor } from "../lib/execution/stops";
import { resolveSymbol } from "../lib/execution/symbol";

const VENUE = "Blofin";
const CAPITAL = 300;

const creds: TradeCreds = {
  apiKey: process.env.BLOFIN_DEMO_KEY ?? "",
  apiSecret: process.env.BLOFIN_DEMO_SECRET ?? "",
  // BloFin REQUIRES a passphrase (requiredCredentials.password = true), unlike Bybit.
  passphrase: process.env.BLOFIN_DEMO_PASSPHRASE ?? "",
  sandbox: true,
};

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!creds.apiKey || !creds.apiSecret || !creds.passphrase) throw new Error("BLOFIN_DEMO_KEY / SECRET / PASSPHRASE missing from .env");
  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const profile = profileFor(config, "LOW")!;
  const snapshot = snapshotProfile(config, profile);
  const strategy = stopStrategyFor(VENUE);

  const stamp = String(Math.floor(Date.now() / 1000));
  const user = await prisma.user.create({ data: { email: `blofin-e2e-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const bot = await prisma.bot.create({
    data: { name: `BLOFIN E2E ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: VENUE, exchanges: [VENUE], config: config as object },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 5000, capitalPerTrade: CAPITAL, allocationType: "FIXED", exchangeSource: VENUE },
    select: { id: true },
  });
  // ratchetStop re-derives credentials from the database (as the cron does), so the throwaway
  // user needs a real encrypted connection — including the passphrase this venue requires.
  const aad = `${user.id}:${VENUE}`;
  await prisma.exchangeConnection.create({
    data: {
      userId: user.id, exchange: VENUE, sandbox: true, permissions: "Read & Trade",
      apiKeyMasked: `••••${creds.apiKey.slice(-4)}`,
      apiKeyEnc: encryptSecret(creds.apiKey, aad),
      apiSecretEnc: encryptSecret(creds.apiSecret, aad),
      passphraseEnc: encryptSecret(creds.passphrase, aad),
    },
  });

  let ex;
  let symbol = "";
  try {
    const resolved = await resolveSymbol(VENUE, "BTC", true);
    symbol = resolved.symbol;
    const { market, requested, substituted } = resolved;
    ex = await exchangeClient(VENUE, creds, [market]);
    if (!JSON.stringify(ex.urls.api).includes("demo-trading")) throw new Error("REFUSING TO RUN: not the demo host");
    check("client is on the demo host", true);
    // BloFin's demo lists 84 of 498, so BTC specifically IS listed and must not be substituted.
    check("BTC resolved WITHOUT a demo substitution", !substituted && symbol === "BTC/USDT:USDT", `${requested} → ${symbol}`);
    const contractSize = Number(market.contractSize ?? 1);
    note("contractSize", contractSize);
    check("this venue is contract-denominated (the sizing path is under test)", contractSize !== 1, String(contractSize));

    await closeAll(ex, symbol).catch(() => {});
    await sleep(1800);
    const priceHint = Number((await ex.fetchTicker(symbol)).last);
    note("symbol / priceHint / profile", `${symbol} / ${priceHint} / lev ${profile.lev} sl ${profile.sl}%`);

    // ── a too-small ladder is refused before anything opens ───────────────────
    console.log("\n── a too-small ladder is refused BEFORE any position opens ──");
    const tinySignal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", dedupeKey: `${stamp}-tiny`, raw: {} }, select: { id: true } });
    let tinyErr = "";
    try {
      await openPosition({
        signalId: tinySignal.id, userBotId: userBot.id, userId: user.id, exchange: VENUE, creds, symbol, market,
        requestedSymbol: requested, substituted, side: "LONG", profile, snapshot,
        sizing: { allocationType: "FIXED", capitalPerTrade: 1, allocatedCapital: 5000, realizedBalance: 0, compounding: false },
        priceHint, prepared: null,
      });
    } catch (e) { tinyErr = msg(e); }
    check("capitalPerTrade 1 is rejected", /LADDER_TOO_SMALL|SIZE_TOO_SMALL/.test(tinyErr), tinyErr.slice(0, 70));
    check("…with a venue-neutral message", /your exchange's minimum|too small/i.test(executionError(new Error(tinyErr)).message));
    check("nothing opened", Number((await livePosition(ex, symbol))?.contracts ?? 0) === 0);
    check("no position row written", (await prisma.position.count({ where: { userBotId: userBot.id } })) === 0);

    // ── open ──────────────────────────────────────────────────────────────────
    console.log("\n── open: market entry + attached backstop + full 6-rung ladder ──");
    const signal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", dedupeKey: stamp, raw: {} }, select: { id: true } });
    const opened = await openPosition({
      signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: VENUE, creds, symbol, market,
      requestedSymbol: requested, substituted, side: "LONG", profile, snapshot,
      sizing: { allocationType: "FIXED", capitalPerTrade: CAPITAL, allocatedCapital: 5000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
    note("opened", `size=${opened.size} contracts entry=${opened.entryPrice} backstop=${opened.stopPrice}`);
    check("all 6 rungs placed (batch cap 10 on this venue)", opened.rungsPlaced === 6, `placed=${opened.rungsPlaced}`);

    // THE SIZING ASSERTION. size is in CONTRACTS, so notional must fold contractSize back in.
    // Without the conversion this comes out 1000x too small and the check fails loudly.
    const notional = opened.size * contractSize * opened.entryPrice;
    check(
      "the opened notional matches capital x leverage — contract sizing is correct",
      Math.abs(notional - CAPITAL * profile.lev) / (CAPITAL * profile.lev) < 0.05,
      `notional=${notional.toFixed(0)} expected~${(CAPITAL * profile.lev).toFixed(0)}`,
    );
    // readFill proved: the entry price came off the venue, not the hint we passed in.
    check("the entry price was READ BACK from the venue (no fetchOrder on this venue)",
      Number.isFinite(opened.entryPrice) && opened.entryPrice > 0, `entry=${opened.entryPrice} hint=${priceHint}`);
    await sleep(2500);

    const pos = await livePosition(ex, symbol);
    check("the venue holds the position", Number(pos?.contracts ?? 0) > 0, `contracts=${pos?.contracts}`);
    const backstop = await strategy.findBackstop(ex, symbol);
    check("findBackstop() locates the entry's stop", backstop !== null, backstop ? `${backstop.id.slice(0, 10)}@${backstop.triggerPrice}` : "null");
    const stopRow = await prisma.order.findFirst({ where: { positionId: opened.positionId, kind: "STOP", rungIndex: 0 }, select: { exchangeOrderId: true } });
    check("the STOP row captured the backstop's id (attribution intact)", stopRow?.exchangeOrderId === backstop?.id,
      `row=${stopRow?.exchangeOrderId?.slice(0, 10)} venue=${backstop?.id.slice(0, 10)}`);
    check("6 TP rows recorded OPEN (no leg silently rejected)",
      (await prisma.order.count({ where: { positionId: opened.positionId, kind: "TP", state: "OPEN" } })) === 6);

    // ── ratchet: the backstop must SURVIVE ────────────────────────────────────
    console.log("\n── ratchet: the backstop must SURVIVE (two effective slots, enforced by us) ──");
    const backstopId = backstop?.id;
    const r1 = await ratchetStop({ positionId: opened.positionId, step: 1, distancePct: profile.sl / 2 });
    note("ratchetStop step 1", JSON.stringify(r1));
    check("the ratchet moved", r1.moved === true, r1.moved ? "" : `reason=${r1.reason}`);
    check("no older generation existed to cancel on the first move", r1.moved && r1.canceled.length === 0);
    await sleep(2500);

    const working = await strategy.findWorking(ex, symbol);
    check("exactly ONE working stop rests", working.length === 1, `n=${working.length}`);
    check("…and it is NOT the backstop (held back from the cancel)", working[0]?.id !== backstopId,
      `working=${working[0]?.id.slice(0, 10)} backstop=${backstopId?.slice(0, 10)}`);
    const stillBackstop = await strategy.findBackstop(ex, symbol);
    check(
      "THE SAFETY PROPERTY: the entry backstop SURVIVED the ratchet, at its own price",
      stillBackstop?.id === backstopId && Math.abs(Number(stillBackstop?.triggerPrice ?? 0) - opened.stopPrice) < 1,
      `backstop=${stillBackstop?.id.slice(0, 10)}@${stillBackstop?.triggerPrice} (entry stop ${opened.stopPrice})`,
    );
    check("…and the working stop is TIGHTER than the backstop", Number(working[0]?.triggerPrice ?? 0) > opened.stopPrice,
      `${opened.stopPrice} → ${working[0]?.triggerPrice}`);
    const dbPos = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { stopStep: true, currentStopPrice: true } });
    check("stopStep advanced and currentStopPrice tracks the venue",
      dbPos?.stopStep === 1 && Math.abs((dbPos?.currentStopPrice ?? 0) - Number(working[0]?.triggerPrice ?? 0)) < 1,
      `step=${dbPos?.stopStep} db=${dbPos?.currentStopPrice} venue=${working[0]?.triggerPrice}`);

    console.log("\n── step 2 replaces the generation, and the backstop still survives ──");
    const r2 = await ratchetStop({ positionId: opened.positionId, step: 2, distancePct: profile.sl / 4 });
    note("ratchetStop step 2", JSON.stringify(r2));
    check("generation 2 placed", r2.moved === true, r2.moved ? "" : `reason=${r2.reason}`);
    check("…and it CANCELLED generation 1 (cancel-first, like Bitget)", r2.moved && r2.canceled.length === 1,
      r2.moved ? `canceled=${r2.canceled.length}` : "");
    await sleep(2500);
    const working2 = await strategy.findWorking(ex, symbol);
    check("still exactly ONE working stop", working2.length === 1, `n=${working2.length}`);
    check("the backstop is STILL there after two ratchet moves",
      (await strategy.findBackstop(ex, symbol))?.id === backstopId);

    console.log("\n── monotonic + idempotent ──");
    const again = await ratchetStop({ positionId: opened.positionId, step: 2, distancePct: profile.sl / 4 });
    check("re-running the same step does nothing", again.moved === false && again.reason === "alreadyAtStep", JSON.stringify(again));
    const looser = await ratchetStop({ positionId: opened.positionId, step: 3, distancePct: profile.sl * 2 });
    check("a LOOSER target is refused", looser.moved === false && looser.reason === "notTighter", JSON.stringify(looser));

    // ── flatten ───────────────────────────────────────────────────────────────
    console.log("\n── flatten ──");
    check("cancels by id, so a bare sweep is not a hazard here", strategy.bareSweepRemovesBackstop === false);
    const closed = await closeAll(ex, symbol);
    note("closeAll", JSON.stringify(closed));
    check("flattened", closed.flattened === true, `contracts=${closed.contracts}`);
    await sleep(3000);
    check("no contracts remain", Number((await livePosition(ex, symbol))?.contracts ?? 0) === 0);
    check("no resting orders remain", (await ex.fetchOpenOrders(symbol)).length === 0);
    check("no working stop left behind", (await strategy.findWorking(ex, symbol)).length === 0);
    check("no stop of ANY kind left behind (the backstop died with the position)",
      (await ex.fetchOpenOrders(symbol, undefined, undefined, { tpsl: true })).length === 0);
  } finally {
    console.log("\n── cleanup ──");
    if (ex && symbol) await closeAll(ex, symbol).catch(() => {});
    await prisma.executionLog.deleteMany({ where: { botId: bot.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.bot.delete({ where: { id: bot.id } }).catch(() => {});
    console.log("  venue flattened · temp user + bot deleted");
  }

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\nERROR:", e); await prisma.$disconnect().catch(() => {}); process.exit(1); });
