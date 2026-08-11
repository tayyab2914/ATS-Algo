/**
 * A BloFin stop-out, booked end to end through the real engine — the BloFin twin of
 * verify-ratchet-fires-demo.ts and verify-ratchet-fires-bybit-demo.ts.
 *
 * THE LAST SAFETY GAP ON THIS VENUE. `syncPosition` books PnL by matching the venue's fills to
 * orders we recorded. When it cannot match, `realizedPnlFor` WIDENS to every fill on the symbol
 * and logs `pnl.attributionIncomplete` — which on an account where the member also trades by hand
 * pulls THEIR fills into the bot's PnL, and that number is what `realizedBalance` compounds from
 * and sizes the next trade with. So an unattributed stop-out is a wrong-number risk, not a
 * labelling one.
 *
 * Each venue links a fired stop to its fill differently, and none of it is guessable:
 *   Bitget — a CHILD market order whose clientOid IS the plan-order id (proven).
 *   Bybit  — SAME-ID: the stop order itself transitions to Filled (proven).
 *   BloFin — UNKNOWN. Its stop is a sized TPSL with its own `tpslId`, and whether the closing
 *            fill carries that id, a child id, or something unrelated has never been tested.
 *            This script answers it, and asserts the outcome the engine needs either way.
 *
 * Fires the stop deterministically-ish by ratcheting it to within a hair of the mark and, if the
 * market moves the other way, retrying on the opposite side. Reports INCONCLUSIVE rather than
 * failing if no attempt is taken out — a quiet market is not a verdict.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-ratchet-fires-blofin-demo.ts
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

const VENUE = "Blofin";
const SYMBOL = "BTC/USDT:USDT";
const CAPITAL = 300;
/**
 * Ratchet the stop to this distance from entry.
 *
 * Tighter than the other venues' twins on purpose, but not arbitrarily: BloFin judges a stop
 * against the LATEST TRADED PRICE and the top of book, not the mark, so too tight a gap is
 * simply rejected (102038/102040) before it can ever fire. This is the compromise — close
 * enough that ordinary drift takes it, loose enough that the venue accepts it.
 */
const NEAR_PCT = 0.06;
const ATTEMPT_MS = 80_000;
const SIDES: ("LONG" | "SHORT")[] = ["LONG", "SHORT", "LONG", "SHORT"];

const creds: TradeCreds = {
  apiKey: process.env.BLOFIN_DEMO_KEY ?? "",
  apiSecret: process.env.BLOFIN_DEMO_SECRET ?? "",
  passphrase: process.env.BLOFIN_DEMO_PASSPHRASE ?? "",
  sandbox: true,
};

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);
const answer = (label: string, value: string) => console.log(`  ★ ${label}: ${value}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!creds.apiKey || !creds.apiSecret || !creds.passphrase) throw new Error("BLOFIN_DEMO_* missing from .env");
  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const profile = profileFor(config, "LOW")!;
  const snapshot = snapshotProfile(config, profile);
  const strategy = stopStrategyFor(VENUE);

  const stamp = String(Math.floor(Date.now() / 1000));
  const user = await prisma.user.create({ data: { email: `blofin-sl-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const bot = await prisma.bot.create({
    data: { name: `BLOFIN SL ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: VENUE, exchanges: [VENUE], config: config as object },
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
      passphraseEnc: encryptSecret(creds.passphrase, aad),
    },
  });

  const market = await getMarket(VENUE, SYMBOL, true);
  const ex = await exchangeClient(VENUE, creds, [market!]);
  if (!JSON.stringify(ex.urls.api).includes("demo-trading")) throw new Error("REFUSING TO RUN: not the demo host");

  let positionId: string | null = null;
  let stopIdWhenArmed: string | null = null;
  let fired = false;
  const since = Date.now() - 60_000;

  try {
    await closeAll(ex, SYMBOL).catch(() => {});
    await sleep(1800);

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
      note("opened", `${side} ${opened.size} contracts @ ${opened.entryPrice} backstop=${opened.stopPrice}`);
      await sleep(2000);

      // The REAL ratchet path — the same code a filled rung drives — so the stop that fires is
      // one the engine placed, not a hand-rolled test order.
      const moved = await ratchetStop({ positionId: opened.positionId, step: 1, distancePct: NEAR_PCT });
      note("ratchetStop", JSON.stringify(moved));
      if (!moved.moved) {
        note("could not ratchet this attempt", `reason=${moved.reason}`);
        await syncPosition(opened.positionId, { flatten: true, reason: "EXIT" }).catch(() => {});
        await sleep(2000);
        continue;
      }
      stopIdWhenArmed = moved.orderId;
      const working = await strategy.findWorking(ex, SYMBOL);
      note("working stop / mark", `${working[0]?.id}@${working[0]?.triggerPrice} / ${(await livePosition(ex, SYMBOL))?.markPrice}`);

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
      console.log("\n  ~ INCONCLUSIVE — no attempt was stopped out. Re-run in a livelier market.");
      return;
    }

    // ── what does the closing fill actually carry? ────────────────────────────
    console.log("\n── the shape of the link, for the record ──");
    const trades = await ex.fetchMyTrades(SYMBOL, since, 50);
    const exits = trades.filter((t) => t.order && t.order !== undefined);
    const matchedById = exits.find((t) => t.order === stopIdWhenArmed);
    note("stop id we recorded", stopIdWhenArmed ?? "(none)");
    note("distinct order ids on fills", [...new Set(exits.map((t) => t.order))].join(", ") || "(none)");
    answer("LINK SHAPE", matchedById
      ? "SAME-ID — the closing fill carries the stop's own id, as on Bybit"
      : "NOT same-id — the fill carries a different order id; attribution must come from elsewhere");

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
    check("PnL was booked", typeof pos?.realizedPnl === "number" && pos.realizedPnl !== 0, `pnl=${pos?.realizedPnl?.toFixed(4)}`);

    // THE ASSERTION THAT DECIDES IT. Widening is the money risk; the label is secondary.
    const widened = await prisma.executionLog.findFirst({
      where: { positionId, event: "pnl.attributionIncomplete" },
      select: { detail: true },
    });
    check(
      "PnL attributed cleanly — NO widening (no contamination from other same-symbol trades)",
      widened === null,
      widened ? `attributionIncomplete: ${JSON.stringify(widened.detail).slice(0, 160)}` : "",
    );
    // A correct label is nice; a correct NUMBER is required. Recorded either way.
    note("closedReason", `${pos?.closedReason}${pos?.closedReason === "SL" ? " (attributed as a stop-out)" : " (degraded label — PnL still correct if no widening above)"}`);

    const deployment = await prisma.userBot.findUnique({ where: { id: userBot.id }, select: { realizedBalance: true } });
    check("realizedBalance moved by exactly the booked PnL",
      Math.abs((deployment?.realizedBalance ?? 0) - (pos?.realizedPnl ?? 0)) < 0.0001,
      `balance=${deployment?.realizedBalance?.toFixed(4)} pnl=${pos?.realizedPnl?.toFixed(4)}`);

    // A stop-out must not leave the ladder resting — a reduce-only limit from this trade would
    // close the NEXT one at this trade's prices.
    check("the TP ladder was swept at settle", (await ex.fetchOpenOrders(SYMBOL)).length === 0);
    check("no working stop left behind", (await strategy.findWorking(ex, SYMBOL)).length === 0);
    check("no stop of ANY kind left behind", (await ex.fetchOpenOrders(SYMBOL, undefined, undefined, { tpsl: true })).length === 0);
    check("no order rows left OPEN",
      (await prisma.order.count({ where: { positionId, state: { in: ["OPEN", "PENDING"] } } })) === 0);
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
