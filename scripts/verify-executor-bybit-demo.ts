/**
 * End-to-end for the executor on BYBIT's demo engine — the Bybit twin of
 * verify-executor-demo.ts, driving the SAME engine functions (openPosition, ratchetStop,
 * closeAll) rather than raw ccxt. This is what "Bybit is integrated" has to mean.
 *
 * The assertions differ from the Bitget twin in one structural way, deliberately: Bybit has ONE
 * stop slot, so the ratchet OVERWRITES the entry's backstop instead of resting beside it. Where
 * the Bitget test asserts "the preset backstop is STILL there, untouched", this one asserts the
 * opposite — same order id, new trigger — because that is the venue's truth and pretending
 * otherwise is how a position ends up unprotected.
 *
 * Note the capital: Bybit's minimum order amount is 0.001 BTC against Bitget's 0.0001, so a
 * 6-rung ladder whose smallest weight is ~0.08 needs a position ~10x larger. The Bitget fixture's
 * capitalPerTrade of 20 would trip LADDER_TOO_SMALL here — which the engine correctly refuses
 * BEFORE opening anything.
 *
 * Refuses to run unless the client is on api-demo (NOT api-testnet, a different exchange).
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-executor-bybit-demo.ts
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

const VENUE = "Bybit";
const CAPITAL = 300; // ~0.019 BTC at 4x — every rung clears Bybit's 0.001 minimum

const creds: TradeCreds = {
  apiKey: process.env.BYBIT_DEMO_KEY ?? "",
  apiSecret: process.env.BYBIT_DEMO_SECRET ?? "",
  // No passphrase: ccxt's bybit adapter inherits requiredCredentials.password = false.
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
  if (!creds.apiKey || !creds.apiSecret) throw new Error("BYBIT_DEMO_KEY / BYBIT_DEMO_SECRET missing from .env");
  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const profile = profileFor(config, "LOW")!; // safe: lev 4, sl 4, be 1, 6 rungs
  const snapshot = snapshotProfile(config, profile);
  const strategy = stopStrategyFor(VENUE);

  const stamp = String(Math.floor(Date.now() / 1000));
  const user = await prisma.user.create({ data: { email: `bybit-e2e-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const bot = await prisma.bot.create({
    data: { name: `BYBIT E2E ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: VENUE, exchanges: [VENUE], config: config as object },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 5000, capitalPerTrade: CAPITAL, allocationType: "FIXED", exchangeSource: VENUE },
    select: { id: true },
  });
  // ratchetStop re-derives credentials from the database (as the cron does), so the throwaway
  // user needs a real encrypted connection. Exercises the decrypt path too — and the fact that
  // passphraseEnc stays NULL for a venue that has no passphrase.
  const aad = `${user.id}:${VENUE}`;
  await prisma.exchangeConnection.create({
    data: {
      userId: user.id, exchange: VENUE, sandbox: true, permissions: "Read & Trade",
      apiKeyMasked: `••••${creds.apiKey.slice(-4)}`,
      apiKeyEnc: encryptSecret(creds.apiKey, aad),
      apiSecretEnc: encryptSecret(creds.apiSecret, aad),
    },
  });

  let ex;
  let symbol = "";
  try {
    const resolved = await resolveSymbol(VENUE, "BTC", true);
    symbol = resolved.symbol;
    const { market, requested, substituted } = resolved;
    ex = await exchangeClient(VENUE, creds, [market]);
    if (!JSON.stringify(ex.urls.api).includes("api-demo")) throw new Error("REFUSING TO RUN: not on api-demo");
    check("client is on api-demo (not testnet, not live)", true);
    // Bybit's demo lists the FULL instrument set, so a real ticker must never be substituted.
    check("BTC resolved WITHOUT a demo substitution", !substituted && symbol === "BTC/USDT:USDT", `${requested} → ${symbol} substituted=${substituted}`);

    await closeAll(ex, symbol).catch(() => {});
    await sleep(1500);
    const priceHint = Number((await ex.fetchTicker(symbol)).last);
    note("symbol / priceHint / profile", `${symbol} / ${priceHint} / lev ${profile.lev} sl ${profile.sl}% be ${profile.be}`);

    // ── the 10x minimum bites first ──────────────────────────────────────────
    console.log("\n── Bybit's larger minimum is refused BEFORE any position opens ──");
    const tinySignal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", dedupeKey: `${stamp}-tiny`, raw: {} }, select: { id: true } });
    let tinyErr = "";
    try {
      await openPosition({
        signalId: tinySignal.id, userBotId: userBot.id, userId: user.id, exchange: VENUE, creds, symbol, market,
        requestedSymbol: requested, substituted, side: "LONG", profile, snapshot,
        // 20 is what the Bitget fixture uses and it is NOT enough here.
        sizing: { allocationType: "FIXED", capitalPerTrade: 20, allocatedCapital: 5000, realizedBalance: 0, compounding: false },
        priceHint, prepared: null,
      });
    } catch (e) { tinyErr = msg(e); }
    check("capitalPerTrade 20 is rejected on Bybit", /LADDER_TOO_SMALL|SIZE_TOO_SMALL/.test(tinyErr), tinyErr.slice(0, 70));
    check("…with a venue-neutral, actionable message", /your exchange's minimum|too small/i.test(executionError(new Error(tinyErr)).message));
    check("nothing opened on the venue", Number((await livePosition(ex, symbol))?.contracts ?? 0) === 0);
    check("no position row written", (await prisma.position.count({ where: { userBotId: userBot.id } })) === 0);

    // ── open ─────────────────────────────────────────────────────────────────
    console.log("\n── open: market entry + attached backstop + full 6-rung ladder ──");
    const signal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", dedupeKey: stamp, raw: {} }, select: { id: true } });
    const t0 = performance.now();
    const opened = await openPosition({
      signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: VENUE, creds, symbol, market,
      requestedSymbol: requested, substituted, side: "LONG", profile, snapshot,
      sizing: { allocationType: "FIXED", capitalPerTrade: CAPITAL, allocatedCapital: 5000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
    note("opened", `${(performance.now() - t0).toFixed(0)}ms  size=${opened.size} entry=${opened.entryPrice} stop=${opened.stopPrice}`);
    check("all 6 rungs placed (batch chunked to Bybit's cap of 10)", opened.rungsPlaced === 6, `placed=${opened.rungsPlaced}`);
    await sleep(2000);

    const pos = await livePosition(ex, symbol);
    check("the venue holds the position", Number(pos?.contracts ?? 0) > 0, `contracts=${pos?.contracts}`);
    const rawStop = (pos?.info as { stopLoss?: string; tpslMode?: string } | undefined) ?? {};
    check("the attached backstop landed ON THE POSITION", (rawStop.stopLoss ?? "") !== "", `stopLoss=${rawStop.stopLoss}`);
    check("…as a SIZELESS Full-mode stop", rawStop.tpslMode === "Full", String(rawStop.tpslMode));

    const backstop = await strategy.findBackstop(ex, symbol);
    check("findBackstop() sees it", backstop !== null, backstop ? `${backstop.id.slice(0, 10)}@${backstop.triggerPrice}` : "null");
    const stopRow = await prisma.order.findFirst({ where: { positionId: opened.positionId, kind: "STOP", rungIndex: 0 }, select: { exchangeOrderId: true } });
    check("the STOP row captured the backstop's id (attribution intact)", stopRow?.exchangeOrderId === backstop?.id, `row=${stopRow?.exchangeOrderId?.slice(0, 10)} venue=${backstop?.id.slice(0, 10)}`);

    const tpRows = await prisma.order.count({ where: { positionId: opened.positionId, kind: "TP", state: "OPEN" } });
    check("6 TP rows recorded OPEN (no leg silently rejected)", tpRows === 6, `n=${tpRows}`);

    // ── ratchet: ONE slot, so this OVERWRITES ────────────────────────────────
    console.log("\n── ratchet on a ONE-SLOT venue: the move overwrites the backstop ──");
    const beforeId = backstop?.id;
    const r1 = await ratchetStop({ positionId: opened.positionId, step: 1, distancePct: profile.sl / 2 });
    note("ratchetStop step 1", JSON.stringify(r1));
    check("the ratchet moved", r1.moved === true, r1.moved ? "" : `reason=${r1.reason}`);
    check("nothing was cancelled (an overwrite venue never cancels)", r1.moved && r1.canceled.length === 0, r1.moved ? `canceled=${r1.canceled.length}` : "");
    await sleep(2000);

    const working = await strategy.findWorking(ex, symbol);
    check("exactly ONE stop rests", working.length === 1, `n=${working.length}`);
    check("…it is the SAME order id as the backstop (one slot, proven)", working[0]?.id === beforeId, `${working[0]?.id.slice(0, 10)} vs ${beforeId?.slice(0, 10)}`);
    const movedPos = await livePosition(ex, symbol);
    const movedStop = Number((movedPos?.info as { stopLoss?: string } | undefined)?.stopLoss ?? 0);
    check("…and the venue's stop is TIGHTER than the original backstop", movedStop > opened.stopPrice, `${opened.stopPrice} → ${movedStop}`);
    const dbPos = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { stopStep: true, currentStopPrice: true } });
    check("stopStep advanced and currentStopPrice tracks the venue", dbPos?.stopStep === 1 && Math.abs((dbPos?.currentStopPrice ?? 0) - movedStop) < 1, `step=${dbPos?.stopStep} db=${dbPos?.currentStopPrice} venue=${movedStop}`);

    console.log("\n── the ratchet is still monotonic and idempotent here ──");
    const again = await ratchetStop({ positionId: opened.positionId, step: 1, distancePct: profile.sl / 2 });
    check("re-running the same step does nothing", again.moved === false && again.reason === "alreadyAtStep", JSON.stringify(again));
    const looser = await ratchetStop({ positionId: opened.positionId, step: 2, distancePct: profile.sl * 2 });
    check("a LOOSER target is refused", looser.moved === false && looser.reason === "notTighter", JSON.stringify(looser));
    const stillOne = await strategy.findWorking(ex, symbol);
    check("still exactly one stop after both refusals", stillOne.length === 1, `n=${stillOne.length}`);
    check("…at the unchanged price", stillOne[0]?.triggerPrice === working[0]?.triggerPrice, `${stillOne[0]?.triggerPrice}`);

    // ── flatten: close BEFORE sweeping on this venue ─────────────────────────
    console.log("\n── flatten: closes first, because a bare sweep would strip the stop ──");
    check("strategy declares the bare-sweep hazard", strategy.bareSweepRemovesBackstop === true);
    const closed = await closeAll(ex, symbol);
    note("closeAll", JSON.stringify(closed));
    check("flattened", closed.flattened === true, `contracts=${closed.contracts}`);
    await sleep(2500);
    check("no contracts remain", Number((await livePosition(ex, symbol))?.contracts ?? 0) === 0);
    check("no resting orders remain", (await ex.fetchOpenOrders(symbol)).length === 0);
    check("no stop left behind", (await strategy.findWorking(ex, symbol)).length === 0);
  } finally {
    console.log("\n── cleanup ──");
    if (ex && symbol) await closeAll(ex, symbol).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.bot.delete({ where: { id: bot.id } }).catch(() => {});
    console.log("  venue flattened · temp user + bot deleted");
  }

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("\nERROR:", e); await prisma.$disconnect().catch(() => {}); process.exit(1); });
