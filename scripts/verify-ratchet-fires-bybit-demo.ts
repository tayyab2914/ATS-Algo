/**
 * A Bybit stop-out, booked end to end through the real engine — the Bybit twin of
 * verify-ratchet-fires-demo.ts.
 *
 * What this proves, and why it is the last thing standing between Bybit and real money:
 * `syncPosition` books PnL by matching the venue's fills to orders we recorded. When it cannot
 * match, `realizedPnlFor` WIDENS to every fill on the symbol and logs
 * `pnl.attributionIncomplete` — which on an account where the member also trades by hand pulls
 * THEIR fills into the bot's PnL, and that number is what `realizedBalance` compounds from and
 * sizes the next trade with. So an unattributed stop-out is a wrong-number risk, not a labelling
 * one.
 *
 * The two venues link a fired stop to its fill by completely different means:
 *   Bitget — a CHILD market order whose clientOid IS the plan-order id.
 *   Bybit  — SAME-ID: the stop order itself transitions to Filled, so the fill carries the very
 *            id we recorded (proven by probe-bybit-stopout-attribution: stop
 *            a08a9561-… produced a fill with trade.order = a08a9561-…, createType
 *            CreateByStopLoss).
 *
 * manage.ts should already handle the second case via its "belt-and-braces" branch. Should is
 * not proof, so this asserts it against a real stop-out: closedReason SL, PnL booked, and NO
 * widening.
 *
 * Fires the stop deterministically by ratcheting it to within a hair of the mark and, if the
 * market moves the other way, retrying on the opposite side.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-ratchet-fires-bybit-demo.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import type { BotConfig } from "../lib/bot-config";
import { profileFor, snapshotProfile } from "../lib/bot-config";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, getMarket, livePosition, type TradeCreds } from "../lib/execution/client";
import { closeAll, openPosition, ratchetStop } from "../lib/execution/execute";
import { syncPosition } from "../lib/execution/manage";
import { stopStrategyFor } from "../lib/execution/stops";

const VENUE = "Bybit";
const SYMBOL = "BTC/USDT:USDT";
const CAPITAL = 300;
/** Ratchet the stop to this distance from entry — a hair inside the mark, so a tick takes it. */
const NEAR_PCT = 0.02;
const ATTEMPT_MS = 75_000;
const SIDES: ("LONG" | "SHORT")[] = ["LONG", "SHORT", "LONG", "SHORT"];

const creds: TradeCreds = {
  apiKey: process.env.BYBIT_DEMO_KEY ?? "",
  apiSecret: process.env.BYBIT_DEMO_SECRET ?? "",
  sandbox: true,
};

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!creds.apiKey || !creds.apiSecret) throw new Error("BYBIT_DEMO_KEY / BYBIT_DEMO_SECRET missing from .env");
  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const profile = profileFor(config, "LOW")!;
  const snapshot = snapshotProfile(config, profile);
  const strategy = stopStrategyFor(VENUE);

  const stamp = String(Math.floor(Date.now() / 1000));
  const user = await prisma.user.create({ data: { email: `bybit-sl-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const bot = await prisma.bot.create({
    data: { name: `BYBIT SL ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: VENUE, exchanges: [VENUE], config: config as object },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 5000, capitalPerTrade: CAPITAL, allocationType: "FIXED", exchangeSource: VENUE },
    select: { id: true },
  });
  const aad = `${user.id}:${VENUE}`;
  await prisma.exchangeConnection.create({
    data: {
      userId: user.id, exchange: VENUE, sandbox: true, permissions: "Read & Trade",
      apiKeyMasked: `••••${creds.apiKey.slice(-4)}`,
      apiKeyEnc: encryptSecret(creds.apiKey, aad),
      apiSecretEnc: encryptSecret(creds.apiSecret, aad),
    },
  });

  const market = await getMarket(VENUE, SYMBOL, true);
  const ex = await exchangeClient(VENUE, creds, [market!]);
  if (!JSON.stringify(ex.urls.api).includes("api-demo")) throw new Error("REFUSING TO RUN: not on api-demo");

  let positionId: string | null = null;
  let fired = false;

  try {
    await closeAll(ex, SYMBOL).catch(() => {});
    await sleep(1500);

    for (const side of SIDES) {
      console.log(`\n── attempt: ${side} ──`);
      const priceHint = Number((await ex.fetchTicker(SYMBOL)).last);
      const signal = await prisma.signal.create({
        data: { botId: bot.id, action: "ENTER", side, dedupeKey: `${stamp}-${side}-${Date.now()}`, raw: {} },
        select: { id: true },
      });

      const opened = await openPosition({
        signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: VENUE, creds,
        symbol: SYMBOL, market: market!, requestedSymbol: SYMBOL, substituted: false,
        side, profile, snapshot,
        sizing: { allocationType: "FIXED", capitalPerTrade: CAPITAL, allocatedCapital: 5000, realizedBalance: 0, compounding: false },
        priceHint, prepared: null,
      });
      positionId = opened.positionId;
      note("opened", `${side} ${opened.size} @ ${opened.entryPrice} backstop=${opened.stopPrice}`);
      await sleep(2000);

      // Ratchet the stop to a hair inside the mark. This is the REAL ratchet path — the same
      // code a filled rung would drive — so the stop that fires is one the engine placed.
      const moved = await ratchetStop({ positionId: opened.positionId, step: 1, distancePct: NEAR_PCT });
      note("ratchetStop", JSON.stringify(moved));
      if (!moved.moved) {
        note("could not ratchet this attempt", `reason=${moved.reason}`);
        await syncPosition(opened.positionId, { flatten: true, reason: "EXIT" }).catch(() => {});
        continue;
      }
      const armed = await livePosition(ex, SYMBOL);
      note("venue stop / mark", `${(armed?.info as { stopLoss?: string })?.stopLoss} / ${armed?.markPrice}`);

      const deadline = Date.now() + ATTEMPT_MS;
      while (Date.now() < deadline) {
        await sleep(4000);
        if (Number((await livePosition(ex, SYMBOL))?.contracts ?? 0) === 0) { fired = true; break; }
      }
      if (fired) { note("STOPPED OUT", "the engine's own stop took the position"); break; }

      note("not taken out", `${ATTEMPT_MS / 1000}s — flattening and switching side`);
      await syncPosition(opened.positionId, { flatten: true, reason: "EXIT" }).catch(() => {});
      await sleep(2000);
    }

    if (!fired || !positionId) {
      console.log("\n  ~ INCONCLUSIVE — no attempt was stopped out. Re-run.");
      return;
    }

    // ── the part that matters: does the engine BOOK it correctly? ─────────────
    console.log("\n── reconcile: the engine settles a stop-out it did not watch happen ──");
    const result = await syncPosition(positionId);
    note("syncPosition", JSON.stringify(result));
    check("the sync closed the position", result.closed === true);

    const pos = await prisma.position.findUnique({
      where: { id: positionId },
      select: { status: true, closedReason: true, realizedPnl: true, size: true },
    });
    check("status CLOSED", pos?.status === "CLOSED", String(pos?.status));
    check(
      "closedReason === 'SL' — the stop-out was attributed (Bybit's SAME-ID shape)",
      pos?.closedReason === "SL",
      `reason=${pos?.closedReason}`,
    );
    check("PnL was booked", typeof pos?.realizedPnl === "number" && pos.realizedPnl !== 0, `pnl=${pos?.realizedPnl?.toFixed(4)}`);

    const widened = await prisma.executionLog.findFirst({
      where: { positionId, event: "pnl.attributionIncomplete" },
      select: { id: true, detail: true },
    });
    check(
      "PnL attributed cleanly — NO widening (no contamination from other same-symbol trades)",
      widened === null,
      widened ? `attributionIncomplete: ${JSON.stringify(widened.detail).slice(0, 140)}` : "",
    );

    // The ladder must not survive a stop-out: a reduce-only limit left resting from this trade
    // would close the NEXT one at this trade's prices.
    const resting = await ex.fetchOpenOrders(SYMBOL);
    check("the TP ladder was swept at settle", resting.length === 0, `n=${resting.length}`);
    check("no stop left behind", (await strategy.findWorking(ex, SYMBOL)).length === 0);
    const openRows = await prisma.order.count({ where: { positionId, state: { in: ["OPEN", "PENDING"] } } });
    check("no order rows left OPEN", openRows === 0, `n=${openRows}`);

    const deployment = await prisma.userBot.findUnique({ where: { id: userBot.id }, select: { realizedBalance: true } });
    check("realizedBalance moved by the booked PnL", Math.abs((deployment?.realizedBalance ?? 0) - (pos?.realizedPnl ?? 0)) < 0.0001,
      `balance=${deployment?.realizedBalance?.toFixed(4)} pnl=${pos?.realizedPnl?.toFixed(4)}`);
  } finally {
    console.log("\n── cleanup ──");
    await closeAll(ex, SYMBOL).catch(() => {});
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
