/**
 * The SHIPPED pos_loss path, end to end, on Bitget's PAPER engine — placement, FIRING (not
 * just placement), and SL attribution, all through the real ratchetStop + syncPosition.
 *
 * Background this replaces: a reduce-only normal_plan movable stop is STARVED by the
 * reduce-only TP ladder (which reserves ~100% of the position) — on trigger it fills 0 and is
 * rejected, so the movable stop NEVER fired in production. The fix is a pos_loss (position-level
 * TPSL) that ignores those reservations. This test proves the fix actually closes the position
 * WITH the full TP ladder still resting, and that the stop-out is attributed as SL.
 *
 * Firing a LONG stop needs price to fall to it. Rather than wait on a quiet demo feed, we HUG
 * the mark from below: each pass tightens the pos_loss to just under the live mark via the real
 * ratchetStop (raising it as the mark rises — never loosening, so the monotonic guard is
 * respected). A normal downtick of ~0.003% then takes it out.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-ratchet-fires-demo.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { profileFor, snapshotProfile, type BotConfig } from "../lib/bot-config";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, type TradeCreds } from "../lib/execution/client";
import { closeAll, openPosition, ratchetStop } from "../lib/execution/execute";
import { syncPosition } from "../lib/execution/manage";
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

  const user = await prisma.user.create({ data: { email: `fire-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const aad = `${user.id}:Bitget`;
  await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "Bitget", sandbox: true, permissions: "Read & Trade", apiKeyMasked: "••••test",
      apiKeyEnc: encryptSecret(creds.apiKey, aad), apiSecretEnc: encryptSecret(creds.apiSecret, aad), passphraseEnc: encryptSecret(creds.passphrase!, aad) },
  });
  const bot = await prisma.bot.create({
    data: { name: `FIRE ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC",
      exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 500, allocationType: "FIXED", exchangeSource: "Bitget" },
    select: { id: true },
  });

  const posLoss = async () => {
    const all = (await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" })) as unknown as Array<{ id: string; info?: Record<string, unknown> }>;
    return { lossPlan: all.filter((o) => o.info?.planType === "loss_plan"), posLoss: all.filter((o) => o.info?.planType === "pos_loss") };
  };
  const limits = () => ex.fetchOpenOrders(symbol);
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
    const E = opened.entryPrice;
    console.log(`  opened ${opened.size} @ ${E} · ${(await limits()).length} reduce-only TP limits resting`);
    const preset0 = (await posLoss()).lossPlan[0]?.id;
    check("the entry preset is a loss_plan on the venue", Boolean(preset0));

    // ── Hug the mark from below via the REAL ratchetStop until the pos_loss fires ──
    console.log("\n── ratchet the pos_loss up under the mark until a downtick fires it ──");
    let step = 0;
    let firstMovedChecked = false;
    let fired = false;
    for (let i = 0; i < 45 && !fired; i++) {
      const M = await mark();
      const target = M * 0.99997;          // 0.003% under the mark: a normal tick clears it
      const d = 100 * (1 - target / E);    // signed distance from entry (negative once M > E)
      const res = await ratchetStop({ positionId: opened.positionId, step: step + 1, distancePct: d });
      if (res.moved) {
        step++;
        if (!firstMovedChecked) {
          firstMovedChecked = true;
          const t = await posLoss();
          check("the movable stop is a pos_loss, resting ALONGSIDE the loss_plan preset (coexist)", t.posLoss.length === 1 && t.lossPlan.length === 1, `pos_loss=${t.posLoss.length} loss_plan=${t.lossPlan.length}`);
          check("…and the TP ladder is STILL fully resting (this is what starves a reduce-only stop)", (await limits()).length >= 5, `${(await limits()).length} limits`);
          const row = await prisma.order.findFirst({ where: { positionId: opened.positionId, kind: "STOP", rungIndex: step }, select: { exchangeOrderId: true } });
          check("the STOP row carries the pos_loss id (not the preset id) — attribution wired", Boolean(row?.exchangeOrderId) && row!.exchangeOrderId === res.orderId && res.orderId !== preset0, `row=${row?.exchangeOrderId} preset=${preset0}`);
        }
      }
      for (let j = 0; j < 4; j++) {
        await sleep(1500);
        if ((await contracts()) === 0) { fired = true; break; }
      }
    }
    check("the pos_loss FIRED and closed the position IN FULL, TP ladder notwithstanding", fired && (await contracts()) === 0, `contracts=${await contracts()} steps=${step}`);

    // ── Settle through the REAL path and assert SL attribution ──
    console.log("\n── syncPosition settles it: SL label + clean PnL via child-clientOid ──");
    const settled = await syncPosition(opened.positionId);
    check("syncPosition booked the close", settled.closed === true, JSON.stringify({ closed: settled.closed, pnl: settled.realizedPnl }));
    const pos = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { status: true, closedReason: true, realizedPnl: true } });
    check("closedReason === 'SL' (the stop-out was attributed via the child order's clientOid)", pos?.closedReason === "SL", `reason=${pos?.closedReason}`);
    check("position CLOSED with a booked PnL", pos?.status === "CLOSED" && pos?.realizedPnl !== null, `status=${pos?.status} pnl=${pos?.realizedPnl?.toFixed(4)}`);
    const widened = await prisma.executionLog.findFirst({ where: { positionId: opened.positionId, event: "pnl.attributionIncomplete" } });
    check("PnL attributed cleanly — no widening (no contamination from other same-symbol trades)", widened === null, widened ? "attributionIncomplete logged" : "");
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
