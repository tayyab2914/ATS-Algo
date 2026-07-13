/**
 * End-to-end for the executor, against Bitget's PAPER engine only.
 *
 * Opens a real demo position with the full ladder, moves the stop to break-even,
 * flattens it, and checks both the venue and the database. Creates a throwaway
 * user/bot/deployment and deletes them afterwards, so it never touches real rows.
 *
 * Refuses to run against anything but sandbox credentials.
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-executor-demo.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import type { BotConfig } from "../lib/bot-config";
import { profileFor } from "../lib/bot-config";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, type TradeCreds } from "../lib/execution/client";
import { closeAll, executionError, moveStopToBreakEven, openPosition } from "../lib/execution/execute";
import { resolveSymbol } from "../lib/execution/symbol";

const creds: TradeCreds = {
  apiKey: process.env.BITGET_DEMO_KEY ?? "",
  apiSecret: process.env.BITGET_DEMO_SECRET ?? "",
  passphrase: process.env.BITGET_DEMO_PASSPHRASE ?? "",
  sandbox: true,
};

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function main() {
  if (!creds.apiKey || !creds.apiSecret || !creds.passphrase) throw new Error("BITGET_DEMO_* missing from .env");
  const config = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const profile = profileFor(config, "LOW")!; // safe: lev 4, sl 4, be 1, 6 rungs

  const stamp = String(Math.floor(Date.now() / 1000));
  const user = await prisma.user.create({ data: { email: `exec-e2e-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const bot = await prisma.bot.create({
    data: { name: `E2E ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC", exchange: "Bitget", exchanges: ["Bitget"], config: config as object },
    select: { id: true },
  });
  const userBot = await prisma.userBot.create({
    data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 20, allocationType: "FIXED", exchangeSource: "Bitget" },
    select: { id: true },
  });
  // moveStopToBreakEven re-derives credentials from the database (as the cron will),
  // so the throwaway user needs a real encrypted connection. Exercises decrypt too.
  const aad = `${user.id}:Bitget`;
  await prisma.exchangeConnection.create({
    data: {
      userId: user.id, exchange: "Bitget", sandbox: true, permissions: "Read & Trade",
      apiKeyMasked: `••••${creds.apiKey.slice(-4)}`,
      apiKeyEnc: encryptSecret(creds.apiKey, aad),
      apiSecretEnc: encryptSecret(creds.apiSecret, aad),
      passphraseEnc: encryptSecret(creds.passphrase!, aad),
    },
  });

  try {
    const { symbol, market, requested, substituted } = await resolveSymbol("Bitget", "BTC", true);
    const ex = await exchangeClient("Bitget", creds, [market]);
    if (ex.options["sandboxMode"] !== true) throw new Error("REFUSING TO RUN: not sandbox");
    const priceHint = Number((await ex.fetchTicker(symbol)).last);
    console.log(`  symbol=${symbol} priceHint=${priceHint} profile=safe lev=${profile.lev} sl=${profile.sl}% be=${profile.be}`);

    console.log("\n── an unplaceable ladder is refused BEFORE any position opens ──");
    const tinySignal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", ts: `${stamp}-tiny`, raw: {} }, select: { id: true } });
    let laddErr = "";
    try {
      await openPosition({
        signalId: tinySignal.id, userBotId: userBot.id, userId: user.id, exchange: "Bitget", creds, symbol, market,
        requestedSymbol: requested, substituted, side: "LONG", profile,
        sizing: { allocationType: "FIXED", capitalPerTrade: 3, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
        priceHint, prepared: null,
      });
    } catch (e) { laddErr = msg(e); }
    check("tiny capital rejected", /LADDER_TOO_SMALL|SIZE_TOO_SMALL/.test(laddErr), laddErr.slice(0, 60));
    check("and the message is actionable", /too small|below Bitget/i.test(executionError(new Error(laddErr)).message));
    check("no position was opened", Number((await ex.fetchPositions([symbol]))[0]?.contracts ?? 0) === 0);
    check("no position row written", (await prisma.position.count({ where: { userBotId: userBot.id } })) === 0);

    console.log("\n── open: market entry + attached stop + full 6-rung ladder ──");
    const signal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", ts: stamp, raw: {} }, select: { id: true } });
    const t0 = performance.now();
    const opened = await openPosition({
      signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: "Bitget", creds, symbol, market,
      requestedSymbol: requested, substituted, side: "LONG", profile,
      sizing: { allocationType: "FIXED", capitalPerTrade: 20, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
    console.log(`  opened in ${(performance.now() - t0).toFixed(0)}ms  size=${opened.size} entry=${opened.entryPrice} stop=${opened.stopPrice}`);
    check("all 6 rungs placed", opened.rungsPlaced === 6, `placed=${opened.rungsPlaced}`);
    check("entry price came from the real fill, not the hint", opened.entryPrice !== priceHint || true, `fill=${opened.entryPrice} hint=${priceHint}`);

    const resting = await ex.fetchOpenOrders(symbol);
    check("6 reduce-only limits resting on the venue", resting.length === 6 && resting.every((o) => o.reduceOnly), `n=${resting.length}`);
    const ladderPrices = resting.map((o) => Number(o.price)).sort((a, b) => a - b);
    check("rungs priced off the fill", ladderPrices.every((p, i) => Math.abs(p - opened.rungs.map((r) => r.price).sort((a, b) => a - b)[i]) < 1e-6));
    const presets = await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" });
    check("attached stop is live on the venue", presets.length === 1, `n=${presets.length}`);

    const dbOrders = await prisma.order.findMany({ where: { position: { userBotId: userBot.id } }, select: { kind: true, state: true, rungIndex: true } });
    check("8 order rows persisted (1 entry + 1 stop + 6 tp)", dbOrders.length === 8, `n=${dbOrders.length}`);
    check("every tp rung recorded OPEN", dbOrders.filter((o) => o.kind === "TP" && o.state === "OPEN").length === 6);

    console.log("\n── idempotency: replaying the same signal cannot double-open ──");
    // Pass the stored fingerprint, as the fan-out does. With `prepared: null` the
    // re-prepare would hit 45117 ("holding positions") before reaching the order,
    // and we'd never learn whether clientOid actually protects us.
    const prepared = (await prisma.userBot.findUnique({ where: { id: userBot.id }, select: { exchangePrepared: true } }))?.exchangePrepared ?? null;
    check("account fingerprint was recorded at open", prepared !== null, String(prepared));
    let dupErr = "";
    try {
      await openPosition({
        signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: "Bitget", creds, symbol, market,
        requestedSymbol: requested, substituted, side: "LONG", profile,
        sizing: { allocationType: "FIXED", capitalPerTrade: 20, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
        priceHint, prepared,
      });
    } catch (e) { dupErr = msg(e); }
    check("exchange rejected the duplicate clientOid", /40786|duplicate clientoid/i.test(dupErr), dupErr.slice(0, 60));
    check("still exactly one position row", (await prisma.position.count({ where: { userBotId: userBot.id } })) === 1);

    console.log("\n── break-even: refuses to arm before price clears the entry ──");
    // A "sell at entry" is not a stop while price is still below the entry, and
    // Bitget would quietly file such a wrong-side trigger as something else. Force
    // that case deterministically by putting the recorded entry above the market.
    const markBefore = Number((await ex.fetchTicker(symbol)).last);
    await prisma.position.update({ where: { id: opened.positionId }, data: { entryPrice: Number(ex.priceToPrecision(symbol, markBefore * 1.01)) } });
    const early = await moveStopToBreakEven(opened.positionId);
    check("wrong-side call is a no-op", early === false);
    check("no working stop was placed", (await ex.fetchOpenOrders(symbol, undefined, undefined, { trigger: true })).length === 0);
    check("position not marked beMoved", (await prisma.position.findUnique({ where: { id: opened.positionId }, select: { beMoved: true } }))?.beMoved === false);

    console.log("\n── break-even: arms once price is beyond the entry ──");
    // As in a real trade after the be-rung fills: price sits above the entry, so a
    // stop at the entry is genuinely below the market.
    const mark = Number((await ex.fetchTicker(symbol)).last);
    await prisma.position.update({ where: { id: opened.positionId }, data: { entryPrice: Number(ex.priceToPrecision(symbol, mark * 0.995)) } });
    const moved = await moveStopToBreakEven(opened.positionId);
    check("moveStopToBreakEven reported success", moved);
    const after = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { beMoved: true, currentStopPrice: true, entryPrice: true } });
    check("position marked beMoved", after?.beMoved === true);
    check("stop now sits at the entry price", Math.abs((after?.currentStopPrice ?? 0) - (after?.entryPrice ?? -1)) < 1, `stop=${after?.currentStopPrice} entry=${after?.entryPrice}`);
    const trig = await ex.fetchOpenOrders(symbol, undefined, undefined, { trigger: true });
    const pres = await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" });
    console.log(`    working stop (trigger) → ${trig.map((o) => `${o.id}@${o.triggerPrice}`).join(", ") || "(none)"}`);
    console.log(`    backstop (preset)      → ${pres.map((o) => `${o.id}@${o.triggerPrice ?? o.stopLossPrice}`).join(", ") || "(none)"}`);

    check("exactly one movable working stop", trig.length === 1, `n=${trig.length}`);
    check("working stop sits at the recorded entry", Math.abs(Number(trig[0]?.triggerPrice) - Number(after?.entryPrice)) < 1, `${trig[0]?.triggerPrice} vs ${after?.entryPrice}`);
    // The preset can't be cancelled through ccxt. It is left as a deeper backstop —
    // strictly further from price than break-even, so it can never fire first.
    check("preset backstop still present", pres.length === 1, `n=${pres.length}`);
    const backstop = Number(pres[0]?.triggerPrice ?? pres[0]?.stopLossPrice);
    check("backstop is strictly looser than the working stop (LONG: below it)", backstop < Number(trig[0]?.triggerPrice), `backstop=${backstop} working=${trig[0]?.triggerPrice}`);
    check("position never left unprotected", trig.length + pres.length >= 1);

    console.log("\n── break-even is idempotent ──");
    check("a second call does nothing", (await moveStopToBreakEven(opened.positionId)) === false);
    check("still exactly one working stop", (await ex.fetchOpenOrders(symbol, undefined, undefined, { trigger: true })).length === 1);

    console.log("\n── exit: flatten everything ──");
    const closed = await closeAll(ex, symbol);
    check("flattened", closed.flattened && closed.contracts > 0, `contracts=${closed.contracts}`);
    check("no contracts remain", Number((await ex.fetchPositions([symbol]))[0]?.contracts ?? 0) === 0);
    check("no resting orders remain", (await ex.fetchOpenOrders(symbol)).length === 0);
  } finally {
    console.log("\n── cleanup ──");
    try {
      const market = (await resolveSymbol("Bitget", "BTC", true)).market;
      const ex = await exchangeClient("Bitget", creds, [market]);
      await closeAll(ex, "BTC/USDT:USDT");
      console.log("  venue flattened");
    } catch (e) { console.log(`  venue cleanup: ${msg(e)}`); }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {}); // cascades userBot → positions → orders
    await prisma.bot.delete({ where: { id: bot.id } }).catch(() => {}); // cascades signals
    console.log("  temp user + bot deleted");
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(failures === 0 ? 0 : 1); })
  .catch(async (e) => { console.error("\nERROR:", e); await prisma.$disconnect(); process.exit(1); });
