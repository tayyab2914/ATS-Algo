/**
 * THE gating unknown for the pos_loss rewrite: when a tighter movable stop is placed while
 * the previous generation still rests, does Bitget ADD a second pos_loss, REPLACE the first,
 * or REJECT the placement? Only cancel-THEN-place was proven before; this settles the other
 * ordering, which decides whether "place new -> cancel stale" (zero unprotected gap) is legal.
 *
 *   ADD     → two pos_loss coexist. "place new -> cancel stale" is safe (no gap). Best.
 *   REPLACE → placing gen N+1 auto-cancels gen N. No explicit cancel needed, no gap. Also fine.
 *   REJECT  → must cancel-first (brief gap, but the preset backstops it the whole time).
 *
 * Also checks: does a fresh clientOid avoid 40786, and does a REPEATED clientOid trigger it
 * (the idempotency the ratchet relies on)?
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-posloss-ordering-demo.ts
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

  const user = await prisma.user.create({ data: { email: `ord-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const aad = `${user.id}:Bitget`;
  await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "Bitget", sandbox: true, permissions: "Read & Trade", apiKeyMasked: "••••test",
      apiKeyEnc: encryptSecret(creds.apiKey, aad), apiSecretEnc: encryptSecret(creds.apiSecret, aad), passphraseEnc: encryptSecret(creds.passphrase!, aad) },
  });
  const bot = await prisma.bot.create({
    data: { name: `ORD ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC",
      exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 30, allocationType: "FIXED", exchangeSource: "Bitget" },
    select: { id: true },
  });

  const profitLoss = () => ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" });
  const byType = async () => {
    const all = (await profitLoss()) as unknown as Array<{ id: string; clientOrderId?: string; info?: Record<string, unknown> }>;
    const loss_plan = all.filter((o) => o.info?.planType === "loss_plan");
    const pos_loss = all.filter((o) => o.info?.planType === "pos_loss");
    return { all, loss_plan, pos_loss };
  };
  const mark = async () => Number((await ex.fetchTicker(symbol)).last);
  const placePosLoss = (trigger: number, oid: string) =>
    ex.createOrder(symbol, "market", "sell", 0.0018, undefined, {
      marginMode: "isolated", oneWayMode: true, stopLossPrice: Number(ex.priceToPrecision(symbol, trigger)), clientOid: oid,
    });

  try {
    const signal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", dedupeKey: String(stamp), raw: {} }, select: { id: true } });
    const priceHint = await mark();
    const opened = await openPosition({
      signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: "Bitget", creds, symbol, market,
      requestedSymbol: requested, substituted: false, side: "LONG", profile, snapshot: snapshotProfile(config, profile),
      sizing: { allocationType: "FIXED", capitalPerTrade: 30, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
    console.log(`  opened ${opened.size} @ ${opened.entryPrice}`);

    const t0 = await byType();
    check("exactly one loss_plan preset, zero pos_loss to start", t0.loss_plan.length === 1 && t0.pos_loss.length === 0, `loss_plan=${t0.loss_plan.length} pos_loss=${t0.pos_loss.length}`);

    // ── gen 1 ──────────────────────────────────────────────────────────────────
    const m = await mark();
    const g1 = await placePosLoss(m * 0.99, `ord-g1-${stamp}`);
    await sleep(1200);
    const t1 = await byType();
    check("gen1 pos_loss placed alongside the preset", t1.pos_loss.length === 1 && t1.loss_plan.length === 1, `pos_loss=${t1.pos_loss.length} loss_plan=${t1.loss_plan.length}`);
    console.log(`  gen1 id=${g1.id} @ ${(m * 0.99).toFixed(1)}`);

    // ── gen 2 WITHOUT cancelling gen1 — the whole question ──────────────────────
    let rejected = false;
    let g2id = "";
    try {
      const g2 = await placePosLoss(m * 0.995, `ord-g2-${stamp}`); // tighter
      g2id = g2.id;
    } catch (e) {
      rejected = true;
      console.log(`  gen2 REJECTED: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
    }
    await sleep(1200);
    const t2 = await byType();
    const n = t2.pos_loss.length;
    const verdict = rejected ? "REJECT" : n >= 2 ? "ADD" : n === 1 ? "REPLACE" : "GONE";
    console.log(`\n  VERDICT: ${verdict}   (pos_loss count after 2nd place = ${n})`);
    console.log(`  pos_loss orders: ${t2.pos_loss.map((o) => `${o.id}@${o.info?.triggerPrice}`).join(" · ")}`);

    if (verdict === "ADD") {
      check("two pos_loss coexist → 'place new, THEN cancel stale' is safe (zero unprotected gap)", n === 2);
      const g1StillThere = t2.pos_loss.some((o) => o.id === g1.id);
      const g2There = t2.pos_loss.some((o) => o.id === g2id);
      check("both generations are present", g1StillThere && g2There, `g1=${g1StillThere} g2=${g2There}`);
      // Now cancel the stale gen1 and confirm ONLY gen1 goes, preset + gen2 remain.
      await ex.cancelOrder(g1.id, symbol, { planType: "pos_loss", trigger: true });
      await sleep(1200);
      const t3 = await byType();
      check("cancelling stale gen1 leaves preset + gen2 (targeted cancel works)", t3.loss_plan.length === 1 && t3.pos_loss.length === 1 && t3.pos_loss[0].id === g2id, `loss_plan=${t3.loss_plan.length} pos_loss=${t3.pos_loss.length}`);
    } else if (verdict === "REPLACE") {
      check("placing gen2 auto-removed gen1 → no explicit cancel needed, no gap", n === 1 && t2.pos_loss[0].id === g2id, `remaining id=${t2.pos_loss[0]?.id}`);
    } else if (verdict === "REJECT") {
      check("REJECT → the ratchet must cancel-first (brief gap; the preset backstops it)", rejected);
      // Confirm cancel-first then place works (already known, but close the loop for this ordering).
      await ex.cancelOrder(g1.id, symbol, { planType: "pos_loss", trigger: true });
      await sleep(1000);
      const g2b = await placePosLoss(m * 0.995, `ord-g2b-${stamp}`);
      await sleep(1000);
      const t3 = await byType();
      check("after cancel-first, the tighter gen places cleanly", t3.pos_loss.length === 1 && t3.pos_loss[0].id === g2b.id);
    }

    // ── idempotency: a REPEATED clientOid must be rejected (40786) ──────────────
    console.log("\n── idempotency: does a repeated clientOid still 40786 for pos_loss? ──");
    let dup = false;
    try {
      await placePosLoss(m * 0.99, `ord-g1-${stamp}`); // same oid as gen1
    } catch (e) {
      dup = /40786|duplicate/i.test(e instanceof Error ? e.message : String(e));
      console.log(`  repeat clientOid → ${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`);
    }
    check("a repeated clientOid is rejected (the ratchet's idempotency holds for pos_loss)", dup);
  } finally {
    console.log("\n── cleanup ──");
    await closeAll(ex, symbol).catch(() => {});
    // pos_loss orders die with the position, but sweep any strays explicitly.
    try {
      for (const o of await profitLoss()) {
        if ((o as unknown as { info?: Record<string, unknown> }).info?.planType === "pos_loss") {
          await ex.cancelOrder(o.id!, symbol, { planType: "pos_loss", trigger: true }).catch(() => {});
        }
      }
    } catch { /* ignore */ }
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
