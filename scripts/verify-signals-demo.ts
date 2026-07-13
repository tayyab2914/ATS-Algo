/**
 * End-to-end for the TradingView signal receiver, fan-out, and the live-money gate.
 *
 * Drives the real HTTP endpoint. Creates three throwaway members on a throwaway
 * bot — one on a demo key, one flagged live but NOT armed, one with no connection —
 * and asserts that exactly the right one trades. Deletes everything afterwards.
 *
 * The only account that ever gets an order is Bitget's paper engine.
 *   1. npm run build && PORT=3100 npm run start
 *   2. NODE_OPTIONS="--conditions=react-server" SIGNALS_BASE=http://localhost:3100 npx tsx scripts/verify-signals-demo.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import type { BotConfig } from "../lib/bot-config";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, getMarket } from "../lib/execution/client";
import { closeAll } from "../lib/execution/execute";
import { rotateSignalSecret } from "../lib/execution/signal-secret";

const BASE = process.env.SIGNALS_BASE ?? "http://localhost:3100";
const demo = { key: process.env.BITGET_DEMO_KEY!, secret: process.env.BITGET_DEMO_SECRET!, pass: process.env.BITGET_DEMO_PASSPHRASE! };

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(what: string, fn: () => Promise<T | null>, ms = 45_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(1000);
  }
  console.log(`    (timed out waiting for ${what})`);
  return null;
}

async function main() {
  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const stamp = Date.now();

  const bot = await prisma.bot.create({
    data: { name: `SIG ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });
  const secret = await rotateSignalSecret(bot.id);

  const mkUser = async (tag: string, opts: { sandbox: boolean; connect: boolean; liveArmed: boolean }) => {
    const user = await prisma.user.create({ data: { email: `sig-${tag}-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
    if (opts.connect) {
      const aad = `${user.id}:Bitget`;
      await prisma.exchangeConnection.create({
        data: { userId: user.id, exchange: "Bitget", sandbox: opts.sandbox, permissions: "Read & Trade", apiKeyMasked: "••••test",
          apiKeyEnc: encryptSecret(demo.key, aad), apiSecretEnc: encryptSecret(demo.secret, aad), passphraseEnc: encryptSecret(demo.pass, aad) },
      });
    }
    const ub = await prisma.userBot.create({
      data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 20, allocationType: "FIXED", exchangeSource: "Bitget", liveArmed: opts.liveArmed },
      select: { id: true },
    });
    return { userId: user.id, userBotId: ub.id };
  };

  // paper: trades. live-not-armed: MUST NOT trade. no-key: cannot trade.
  const paper = await mkUser("paper", { sandbox: true, connect: true, liveArmed: false });
  const liveUnarmed = await mkUser("liveoff", { sandbox: false, connect: true, liveArmed: false });
  const keyless = await mkUser("nokey", { sandbox: true, connect: false, liveArmed: false });

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/api/signals/${bot.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const enter = (ts: number, extra: Record<string, unknown> = {}) => post({ action: "enter", side: "long", ts: String(ts), price: "64400", secret, ...extra });

  try {
    console.log("── rejects what it should ──");
    const badJson = await fetch(`${BASE}/api/signals/${bot.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
    check("malformed JSON → 400", badJson.status === 400, String(badJson.status));
    check("missing secret → 400", (await post({ action: "enter", side: "long", ts: `${stamp}`, price: "1" })).status === 400);
    check("wrong secret → 401", (await enter(stamp, { secret: "not-the-secret" })).status === 401);
    check("unknown bot id → 401 (no enumeration)", (await fetch(`${BASE}/api/signals/does-not-exist`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enter", side: "long", ts: `${stamp}`, price: "1", secret }) })).status === 401);
    check("unknown action → 400", (await post({ action: "frobnicate", ts: `${stamp}`, secret })).status === 400);
    check("enter without side → 400", (await post({ action: "enter", ts: `${stamp}`, price: "1", secret })).status === 400);
    check("enter without price → 400", (await post({ action: "enter", side: "long", ts: `${stamp}`, secret })).status === 400);
    check("ts far in the future → 400", (await enter(stamp + 3 * 60 * 60 * 1000)).status === 400);
    check("ts older than a week → 400", (await enter(stamp - 8 * 24 * 3600 * 1000)).status === 400);
    check("no signal rows written by any rejection", (await prisma.signal.count({ where: { botId: bot.id } })) === 0);

    console.log("\n── accepts a valid entry, fast ──");
    const t0 = performance.now();
    const ok = await enter(stamp);
    const ackMs = performance.now() - t0;
    check("200 received", ok.status === 200 && ok.body.received === true, JSON.stringify(ok.body));
    check("acknowledged quickly (fan-out happens after the response)", ackMs < 3000, `${ackMs.toFixed(0)}ms`);

    console.log("\n── replay is dropped by the unique index ──");
    const replay = await enter(stamp);
    check("200 duplicate", replay.status === 200 && replay.body.duplicate === true, JSON.stringify(replay.body));
    check("still exactly one signal row", (await prisma.signal.count({ where: { botId: bot.id, action: "ENTER" } })) === 1);

    console.log("\n── fan-out: only the paper deployment trades ──");
    const position = await waitFor("position", async () => prisma.position.findFirst({ where: { userBotId: paper.userBotId }, select: { id: true, symbol: true, side: true, size: true, entryPrice: true, sandbox: true } }));
    check("paper deployment opened a position", position !== null, position ? `${position.side} ${position.size} @ ${position.entryPrice}` : "");
    check("and it is a sandbox position", position?.sandbox === true);
    check("replay did NOT open a second position", (await prisma.position.count({ where: { userBotId: paper.userBotId } })) === 1);

    // THE GATE. A live key with liveArmed=false must be skipped before any exchange call.
    check("live-but-unarmed deployment opened NOTHING", (await prisma.position.count({ where: { userBotId: liveUnarmed.userBotId } })) === 0);
    const armLog = await prisma.executionLog.findFirst({ where: { userBotId: liveUnarmed.userBotId, event: "fanout.skip.liveNotArmed" } });
    check("…and was skipped with reason liveNotArmed", armLog !== null);
    check("keyless deployment skipped", (await prisma.executionLog.findFirst({ where: { userBotId: keyless.userBotId, event: "fanout.skip.noConnection" } })) !== null);

    const orders = await prisma.order.count({ where: { positionId: position?.id } });
    check("8 orders persisted (entry + preset stop + 6 rungs)", orders === 8, `n=${orders}`);
    const stop = await prisma.order.findFirst({ where: { positionId: position?.id, kind: "STOP" }, select: { exchangeOrderId: true } });
    check("preset stop id captured", Boolean(stop?.exchangeOrderId), String(stop?.exchangeOrderId));

    console.log("\n── rate limiting ──");
    await prisma.signal.createMany({ data: Array.from({ length: 20 }, (_, i) => ({ botId: bot.id, action: "TP9" as const, ts: `${stamp + 1000 + i}`, raw: {} })) });
    // A numeric, fresh, unused ts — so it reaches the rate limiter rather than
    // being rejected earlier by the timestamp or duplicate checks.
    check("flood → 429", (await post({ action: "tp9", ts: `${stamp + 5000}`, secret })).status === 429);
    await prisma.signal.deleteMany({ where: { botId: bot.id, action: "TP9" } });

    console.log("\n── exit flattens and books realized PnL ──");
    const exitRes = await post({ action: "exit", ts: `${stamp + 1}`, secret });
    check("exit accepted", exitRes.status === 200, JSON.stringify(exitRes.body));
    const closed = await waitFor("close", async () => {
      const p = await prisma.position.findFirst({ where: { userBotId: paper.userBotId, status: "CLOSED" }, select: { id: true, realizedPnl: true, closedReason: true } });
      return p;
    });
    check("position closed", closed !== null, closed ? `reason=${closed.closedReason} pnl=${closed.realizedPnl.toFixed(4)}` : "");
    const ub = await prisma.userBot.findUnique({ where: { id: paper.userBotId }, select: { realizedBalance: true } });
    check("realizedBalance updated for compounding", ub !== null && Math.abs(ub.realizedBalance - (closed?.realizedPnl ?? 0)) < 1e-9, `balance=${ub?.realizedBalance.toFixed(4)}`);
    check("PnL is negative-ish (fees on an immediate round trip)", (closed?.realizedPnl ?? 1) < 0, `pnl=${closed?.realizedPnl.toFixed(4)}`);
    const closeOrder = await prisma.order.findFirst({ where: { positionId: closed?.id, kind: "CLOSE" }, select: { exchangeOrderId: true } });
    check("closing order recorded (its fills are attributable)", Boolean(closeOrder?.exchangeOrderId));
  } finally {
    console.log("\n── cleanup ──");
    // Flatten the venue BEFORE dropping rows: a leftover demo position makes the
    // next run fail with 45117 when it tries to set leverage.
    try {
      const market = await getMarket("Bitget", "BTC/USDT:USDT", true);
      const ex = await exchangeClient("Bitget", { apiKey: demo.key, apiSecret: demo.secret, passphrase: demo.pass, sandbox: true }, [market!]);
      const result = await closeAll(ex, "BTC/USDT:USDT");
      console.log(`  venue flattened (${result.contracts} contracts)`);
    } catch (e) {
      console.log(`  venue cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const u of [paper, liveUnarmed, keyless]) await prisma.user.delete({ where: { id: u.userId } }).catch(() => {});
    await prisma.executionLog.deleteMany({ where: { botId: bot.id } }).catch(() => {});
    await prisma.bot.delete({ where: { id: bot.id } }).catch(() => {});
    console.log("  temp users + bot deleted");
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("\nERROR:", e); await prisma.$disconnect(); process.exit(1); });
