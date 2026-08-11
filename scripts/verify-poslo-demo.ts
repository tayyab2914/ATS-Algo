/**
 * The fix for the P0: a reduce-only plan stop can never fire while the take-profit ladder
 * is resting (Bitget reserves position size for reduce-only limits, and our ladder claims
 * 100% of it — the stop triggers and is REJECTED).
 *
 * The preset does not have this problem, because it is a POSITION-level TPSL: it closes
 * the position rather than reducing it, so reservations do not apply. So the movable stop
 * must be the same kind of order.
 *
 * `params.stopLossPrice` mints exactly that — a `pos_loss`. The codebase currently FORBIDS
 * it ("mints another uncancellable TPSL"). This settles whether that prohibition is right:
 *
 *   1. Can a pos_loss be placed while the preset already exists? (Or is there one SL slot?)
 *   2. Does it carry a size, or does it close the whole position?
 *   3. Can it be CANCELLED — i.e. can the ratchet move it, generation to generation?
 *   4. When it fires with the TP ladder resting, does it close the position IN FULL?
 *
 * (4) is the one the ladder lives or dies on.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-poslo-demo.ts
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

  const user = await prisma.user.create({ data: { email: `poslo-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const aad = `${user.id}:Bitget`;
  await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "Bitget", sandbox: true, permissions: "Read & Trade", apiKeyMasked: "••••test",
      apiKeyEnc: encryptSecret(creds.apiKey, aad), apiSecretEnc: encryptSecret(creds.apiSecret, aad), passphraseEnc: encryptSecret(creds.passphrase!, aad) },
  });
  const bot = await prisma.bot.create({
    data: { name: `POSLO ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC",
      exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 30, allocationType: "FIXED", exchangeSource: "Bitget" },
    select: { id: true },
  });

  const tpsls = () => ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" });
  const limits = () => ex.fetchOpenOrders(symbol);
  const contracts = async () => Number((await ex.fetchPositions([symbol]))[0]?.contracts ?? 0);
  const side = async () => (await ex.fetchPositions([symbol]))[0]?.side ?? null;
  const mark = async () => Number((await ex.fetchTicker(symbol)).last);
  const show = async (label: string) => {
    const all = (await tpsls()) as unknown as Array<{ id: string; info?: Record<string, unknown> }>;
    console.log(`  ${label}: ${all.map((o) => `${o.info?.planType}@${o.info?.triggerPrice}(size ${o.info?.size ?? "—"})`).join(" · ") || "(none)"}`);
    return all;
  };

  try {
    const signal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", dedupeKey: String(stamp), raw: {} }, select: { id: true } });
    const priceHint = await mark();
    const opened = await openPosition({
      signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: "Bitget", creds, symbol, market,
      requestedSymbol: requested, substituted: false, side: "LONG", profile, snapshot: snapshotProfile(config, profile),
      sizing: { allocationType: "FIXED", capitalPerTrade: 30, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
    console.log(`  opened ${opened.size} @ ${opened.entryPrice} · ${opened.rungsPlaced} reduce-only TP limits resting`);
    check("the TP ladder is on the book (this is what starves a reduce-only stop)", (await limits()).length > 0, `${(await limits()).length} limits`);
    await show("after entry");

    // ── 1. can a pos_loss coexist with the preset? ────────────────────────────
    console.log("\n── 1. place a POSITION stop (pos_loss) alongside the preset ──");
    const t1 = Number(ex.priceToPrecision(symbol, (await mark()) * 0.99));
    const p1 = await ex.createOrder(symbol, "market", "sell", opened.size, undefined, {
      marginMode: "isolated", oneWayMode: true, stopLossPrice: t1, clientOid: `poslo-a-${stamp}`,
    });
    check("a pos_loss was accepted while the preset exists", Boolean(p1.id), `id=${p1.id}`);
    const after1 = await show("after pos_loss");
    const mine1 = after1.find((o) => o.id === p1.id);
    check("it is a POSITION stop (pos_loss), not a sized loss_plan", mine1?.info?.planType === "pos_loss", String(mine1?.info?.planType));
    check("the preset is still there too — they coexist", after1.some((o) => o.info?.planType === "loss_plan"), `${after1.length} tpsl orders`);

    // ── 2. can it be moved? (cancel + replace = a ratchet generation) ──────────
    console.log("\n── 2. can the ratchet MOVE it? (cancel, then re-place tighter) ──");
    let cancellable = false;
    try {
      await ex.cancelOrder(p1.id, symbol, { planType: "pos_loss", trigger: true });
      await sleep(1200);
      cancellable = !(await tpsls()).some((o) => o.id === p1.id);
    } catch (e) {
      console.log(`     cancel rejected: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
    }
    check("a pos_loss CAN be cancelled (so the ratchet can move it)", cancellable);
    await show("after cancel");

    // Bitget rejects a pos_loss placed ABOVE the mark for a long (40917) — unlike a plan
    // order, which silently re-files a wrong-side trigger. So we cannot force an instant
    // fire; we chase the mark DOWN instead. Each generation is placed a hair below the
    // live mark, and cancelled + re-placed lower until a downtick takes it out. This is
    // exactly the cancel+replace the ratchet itself uses, so it exercises the real path.
    console.log("\n── 3. chase it down until it fires, with the whole TP ladder still resting ──");
    let flat = false;
    let lastId = "";
    for (let i = 0; i < 25 && !flat; i++) {
      if (lastId) {
        try { await ex.cancelOrder(lastId, symbol, { planType: "pos_loss", trigger: true }); } catch { /* may have fired */ }
      }
      if ((await contracts()) === 0) { flat = true; break; }
      const t = Number(ex.priceToPrecision(symbol, (await mark()) * 0.99997)); // ~0.003% below
      try {
        const g = await ex.createOrder(symbol, "market", "sell", opened.size, undefined, {
          marginMode: "isolated", oneWayMode: true, stopLossPrice: t, clientOid: `poslo-b${i}-${stamp}`,
        });
        lastId = g.id;
        if (i === 0) check("a tighter pos_loss can be placed (generation 2)", Boolean(g.id), `trigger=${t}`);
      } catch (e) {
        // 40917 = the mark ticked UP between read and place; just retry lower next loop.
        if (!(e instanceof Error && e.message.includes("40917"))) throw e;
      }
      for (let j = 0; j < 6; j++) {
        await sleep(1500);
        if ((await contracts()) === 0) { flat = true; break; }
      }
    }
    await sleep(2500);
    const left = await contracts();
    const s = await side();
    console.log(`  position ${opened.size} → ${left} (${s ?? "flat"}) · TP limits left: ${(await limits()).length}`);

    check("the position stop FIRED and closed the position IN FULL — reservations do not starve it",
      flat && left === 0 && s === null, `contracts=${left} side=${s ?? "flat"}`);
    check("…and it did not overshoot into a reverse position", s !== "short");

    if (flat && left === 0) {
      console.log("\n  ⇒ CONFIRMED: pos_loss is the right order type for the movable stop.");
      console.log("    It closes the POSITION, so the reduce-only TP reservations cannot starve it,");
      console.log("    and (unlike the preset) it can be cancelled — so the ratchet can move it.");
    }
  } finally {
    console.log("\n── cleanup ──");
    await closeAll(ex, symbol).catch(() => {});
    await ex.cancelAllOrders(symbol, {}).catch(() => {});
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
