/**
 * The gating unknown for the pos_loss rewrite (audit verdict: "the single riskiest unknown"):
 * when a pos_loss fires, does its closing FILL carry the pos_loss order's id in fetchMyTrades?
 *
 *   YES → closedReason can be 'SL' and PnL attributes cleanly off the order id.
 *   NO  → the id must be recovered another way (clientOid on the fill, or time+price+side),
 *         else every ratchet stop-out books RECONCILE and PnL takes the widened path.
 *
 * We place a pos_loss, capture its id THREE ways (createOrder return, fetchOpenOrders match by
 * clientOid, and the raw order id), chase the mark down until it fires, then dump every closing
 * fill's identity fields so we can see exactly what a stop-out is attributable by.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-posloss-attribution-demo.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { profileFor, snapshotProfile, type BotConfig } from "../lib/bot-config";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, type TradeCreds } from "../lib/execution/client";
import { closeAll, openPosition } from "../lib/execution/execute";
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const profile = profileFor(config, "LOW")!;
  const stamp = Date.now();

  const { symbol, market, requested } = await resolveSymbol("Bitget", "BTC", true);
  const ex = await exchangeClient("Bitget", creds, [market]);
  if (ex.options["sandboxMode"] !== true) throw new Error("REFUSING TO RUN: not sandbox");
  await closeAll(ex, symbol).catch(() => {});

  const user = await prisma.user.create({ data: { email: `attr-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const aad = `${user.id}:Bitget`;
  await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "Bitget", sandbox: true, permissions: "Read & Trade", apiKeyMasked: "••••test",
      apiKeyEnc: encryptSecret(creds.apiKey, aad), apiSecretEnc: encryptSecret(creds.apiSecret, aad), passphraseEnc: encryptSecret(creds.passphrase!, aad) },
  });
  const bot = await prisma.bot.create({
    data: { name: `ATTR ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC",
      exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 500, allocationType: "FIXED", exchangeSource: "Bitget" },
    select: { id: true },
  });

  const posLossOrders = async () => {
    const all = (await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" })) as unknown as Array<{ id: string; clientOrderId?: string; info?: Record<string, unknown> }>;
    return all.filter((o) => o.info?.planType === "pos_loss");
  };
  const contracts = async () => Number((await ex.fetchPositions([symbol]))[0]?.contracts ?? 0);
  const mark = async () => Number((await ex.fetchTicker(symbol)).last);

  try {
    const signal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", dedupeKey: String(stamp), raw: {} }, select: { id: true } });
    const priceHint = await mark();
    const opened = await openPosition({
      signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: "Bitget", creds, symbol, market,
      requestedSymbol: requested, substituted: false, side: "LONG", profile, snapshot: snapshotProfile(config, profile),
      sizing: { allocationType: "FIXED", capitalPerTrade: 500, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
    console.log(`  opened ${opened.size} @ ${opened.entryPrice} (full TP ladder resting)`);

    const clientOid = `attr-${stamp}`;
    let createReturnId = "";
    let chaseFrom = await mark();
    // Place + chase down until it fires. Re-place (fresh oid each time) at a hair below the
    // live mark; REPLACE-in-place keeps one slot. Capture the id by clientOid match.
    let capturedId = "";
    let capturedClientOid = "";
    let fired = false;
    for (let i = 0; i < 25 && !fired; i++) {
      // The stop may have fired between iterations; placing a pos_loss on a flat position is
      // rejected (43023 "Insufficient position"), so stop chasing the moment we are flat.
      if ((await contracts()) === 0) { fired = true; break; }
      const oid = `${clientOid}-${i}`;
      const t = Number(ex.priceToPrecision(symbol, (await mark()) * 0.99997));
      try {
        const g = await ex.createOrder(symbol, "market", "sell", opened.size, undefined, {
          marginMode: "isolated", oneWayMode: true, stopLossPrice: t, clientOid: oid,
        });
        if (i === 0) { createReturnId = g.id ?? ""; chaseFrom = t; }
        await sleep(800);
        const live = (await posLossOrders()).find((o) => o.clientOrderId === oid) ?? (await posLossOrders())[0];
        if (live) { capturedId = live.id; capturedClientOid = live.clientOrderId ?? ""; }
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        if (/43023|insufficient position/i.test(em)) { fired = true; break; } // fired mid-chase
        if (!/40917|40786/.test(em)) throw e;
      }
      for (let j = 0; j < 5; j++) {
        await sleep(1200);
        if ((await contracts()) === 0) { fired = true; break; }
      }
    }

    console.log(`  createOrder returned id: ${createReturnId || "(none)"}`);
    console.log(`  captured pos_loss id (via fetchOpenOrders): ${capturedId || "(none)"}  clientOid=${capturedClientOid}`);
    check("the pos_loss fired and closed the position", fired && (await contracts()) === 0, `contracts=${await contracts()}`);
    check("we captured a usable pos_loss order id before it fired", Boolean(capturedId));

    // The whole point: what identity fields does the CLOSING fill carry?
    await sleep(2500);
    const trades = await ex.fetchMyTrades(symbol, stamp - 60_000, 100);
    const sells = trades.filter((t) => t.side === "sell");
    console.log(`\n  ── closing sell fills (${sells.length}) ──`);
    let childOrderId = "";
    for (const t of sells) {
      const info = (t.info ?? {}) as Record<string, unknown>;
      console.log(`   amount=${t.amount} price=${t.price} order=${t.order ?? "(none)"}`);
      console.log(`     enterPointSource=${info.enterPointSource ?? "—"} tradeSide=${info.tradeSide ?? "—"} side=${info.side ?? "—"} posMode=${info.posMode ?? "—"} profit=${info.profit ?? "—"}`);
      if (t.order) childOrderId = t.order;
    }
    // THE finding: the fill's `t.order` is a CHILD market order minted on trigger, NOT the
    // pos_loss plan order. But the child's clientOid === the pos_loss plan-order id. So a
    // stop-out is attributed by resolving the child and matching its clientOid — which is
    // exactly what manage.ts settle now does.
    let childClientOid = "";
    if (childOrderId) {
      const child = await ex.fetchOrder(childOrderId, symbol);
      const ci = (child.info ?? {}) as Record<string, unknown>;
      childClientOid = String(child.clientOrderId ?? ci.clientOid ?? "");
      console.log(`\n  child order ${childOrderId}: clientOid=${childClientOid || "—"} profit=${ci.totalProfits ?? "—"}`);
    }

    const byOrder = sells.some((t) => t.order === capturedId || t.order === createReturnId);
    const byChildClientOid = Boolean(childClientOid) && childClientOid === capturedId;

    // The fill does NOT carry the plan id directly — this documents that, so a future reader
    // doesn't "simplify" the settle matcher back to a bare t.order check.
    check("the fill's t.order is the CHILD order, not the pos_loss plan id (do NOT match bare t.order)", !byOrder,
      byOrder ? "unexpected: venue changed — the plan id is now on the fill" : "confirmed: child id, not plan id");
    // The real attribution path: child.clientOid === our pos_loss plan-order id.
    check("the child order's clientOid === the pos_loss plan-order id → clean SL attribution", byChildClientOid,
      `child.clientOid=${childClientOid} vs pos_loss id=${capturedId}`);

    console.log(`\n  VERDICT: a pos_loss stop-out is attributed by resolving the child order and matching child.clientOid to the recorded stop plan id (implemented in manage.ts settle).`);
  } finally {
    console.log("\n── cleanup ──");
    await closeAll(ex, symbol).catch(() => {});
    for (const o of await posLossOrders().catch(() => [])) {
      await ex.cancelOrder(o.id, symbol, { planType: "pos_loss", trigger: true }).catch(() => {});
    }
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
