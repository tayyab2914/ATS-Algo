/**
 * Does an OVERSIZED reduce-only `normal_plan` (our movable ratchet stop) clamp to the
 * position when it fires — or does it evaporate, or flip us short?
 *
 * The preset was settled separately (`verify-preset-demo.ts`): it CLAMPS. This is the
 * same question for the other stop family, and it is the one the ratchet rides on.
 *
 * It matters because of a real window: the ratchet is sized from the live position when
 * it is placed, but a take-profit rung can fill straight after, shrinking the position
 * beneath a stop that is already resting. Until the next sync re-sizes it, that stop is
 * oversized. If an oversized plan order EVAPORATES on trigger, that window is a hole.
 *
 * We do not wait for the market to come to the stop — that timed out and proved nothing.
 * We drag the stop onto the market. Passing `amount: undefined` to editOrder makes ccxt
 * omit `newSize`, so the order keeps its original OVERSIZED size while only its trigger
 * moves — which is precisely the state we need to test.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-oversized-stop-demo.ts
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

  const user = await prisma.user.create({ data: { email: `ovr-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const aad = `${user.id}:Bitget`;
  await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "Bitget", sandbox: true, permissions: "Read & Trade", apiKeyMasked: "••••test",
      apiKeyEnc: encryptSecret(creds.apiKey, aad), apiSecretEnc: encryptSecret(creds.apiSecret, aad), passphraseEnc: encryptSecret(creds.passphrase!, aad) },
  });
  const bot = await prisma.bot.create({
    data: { name: `OVR ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC",
      exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 30, allocationType: "FIXED", exchangeSource: "Bitget" },
    select: { id: true },
  });

  const plans = () => ex.fetchOpenOrders(symbol, undefined, undefined, { trigger: true });
  const position = async () => (await ex.fetchPositions([symbol]))[0] ?? null;
  const contracts = async () => Number((await position())?.contracts ?? 0);
  const mark = async () => Number((await ex.fetchTicker(symbol)).last);

  try {
    const signal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", ts: String(stamp), raw: {} }, select: { id: true } });
    const priceHint = await mark();
    const opened = await openPosition({
      signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: "Bitget", creds, symbol, market,
      requestedSymbol: requested, substituted: false, side: "LONG", profile, snapshot: snapshotProfile(config, profile),
      sizing: { allocationType: "FIXED", capitalPerTrade: 30, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
    console.log(`  opened ${opened.size} @ ${opened.entryPrice} (preset parked ~4% away, it cannot interfere)`);

    // A reduce-only plan stop sized to the FULL position — same shape the ratchet places.
    const stop = await ex.createOrder(symbol, "market", "sell", opened.size, undefined, {
      marginMode: "isolated", oneWayMode: true, reduceOnly: true,
      triggerPrice: Number(ex.priceToPrecision(symbol, (await mark()) * 0.999)),
      clientOid: `ovr-${stamp}`,
    });
    check("a reduce-only plan stop is resting, sized to the full position", (await plans()).length === 1, `size=${opened.size}`);

    // Shrink the position beneath it — this is what a filled take-profit rung does.
    const half = Number(ex.amountToPrecision(symbol, opened.size / 2));
    await ex.createOrder(symbol, "market", "sell", half, undefined, { reduceOnly: true, oneWayMode: true });
    await sleep(1500);
    const left = await contracts();
    check("the position halved — the resting stop is now OVERSIZED", left > 0 && left < opened.size, `stop=${opened.size} vs position=${left}`);

    // Drag the trigger onto the market. `amount: undefined` → ccxt omits newSize, so the
    // order stays oversized; only the trigger price moves.
    console.log(`  dragging the trigger onto the market (size stays ${opened.size} vs position ${left})…`);
    let fired = false;
    for (let i = 0; i < 20 && !fired; i++) {
      const live = (await plans())[0] as unknown as { id: string; amount?: number; triggerPrice?: number; info?: Record<string, unknown> } | undefined;
      if (!live) { fired = true; break; }
      if (i === 0) console.log(`     resting: size=${live.info?.size} trigger=${live.info?.triggerPrice} status=${live.info?.planStatus ?? live.info?.status}`);

      const m = await mark();
      const trigger = Number(ex.priceToPrecision(symbol, m * 0.99995)); // a hair below the mark
      try {
        await ex.editOrder(stop.id, symbol, "market", "sell", undefined, undefined, { triggerPrice: trigger });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("43025")) { fired = true; console.log(`     the plan order left the book (43025) after ${i} drags`); break; }
        console.log(`     drag #${i + 1}: ${msg.slice(0, 90)}`);
      }
      for (let j = 0; j < 5; j++) {
        await sleep(1200);
        if ((await contracts()) === 0 || (await plans()).length === 0) { fired = true; break; }
      }
    }
    check("the stop left the book (it fired or was consumed)", fired);

    await sleep(3000);
    const after = await position();
    const size = Number(after?.contracts ?? 0);
    const side = after?.side ?? null;
    const resting = (await plans()).length;

    const verdict = size === 0 && side === null ? "CLAMP"
      : side === "short" ? "OVERSHOOT"
      : resting === 0 ? "REJECT"
      : "UNCLEAR";
    console.log(`\n  VERDICT: ${verdict}   position=${size} ${side ?? "flat"}   resting plan stops=${resting}`);

    // The order's own final state is what separates "closed the position" from "was thrown away".
    const hist = await ex.fetchCanceledAndClosedOrders(symbol, stamp - 60_000, 50, { trigger: true }).catch(() => []);
    const mine = hist.find((o) => o.id === stop.id || o.clientOrderId === `ovr-${stamp}`) as unknown as { status?: string; filled?: number; amount?: number; info?: Record<string, unknown> } | undefined;
    console.log(`  the plan order's final state → status=${mine?.status ?? "(not in history)"} filled=${mine?.filled ?? "?"} of ${mine?.amount ?? "?"}`);
    if (mine?.info) console.log(`  raw → ${JSON.stringify({ planStatus: mine.info.planStatus, size: mine.info.size, tradeSide: mine.info.tradeSide })}`);

    const trades = await ex.fetchMyTrades(symbol, stamp - 60_000, 100);
    const sells = trades.filter((t) => t.side === "sell");
    console.log(`  sell fills → ${sells.map((t) => `${t.amount}@${t.price} (order ${t.order})`).join(" · ")}`);

    check("an oversized plan stop CLAMPS to the position — it neither evaporates nor reverses", verdict === "CLAMP", `verdict=${verdict}`);
    if (verdict === "REJECT") console.log("  🚨 the stop was consumed WITHOUT closing the position. The ratchet must be re-sized the instant a rung fills.");
    if (verdict === "OVERSHOOT") console.log("  🚨 the stop opened a naked REVERSE position.");

    // Attribution — does the closing fill name the plan order?
    check("the triggered fill is attributable to the plan order (so a close can be labelled SL)",
      sells.some((t) => t.order === stop.id),
      sells.some((t) => t.order === stop.id) ? "" : "→ closedReason degrades to RECONCILE: safe, but the close is not labelled SL");
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
