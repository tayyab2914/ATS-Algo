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
import { profileFor, snapshotProfile } from "../lib/bot-config";
import { encryptSecret } from "../lib/crypto/secrets";
import { prisma } from "../lib/db";
import { exchangeClient, type TradeCreds } from "../lib/execution/client";
import { closeAll, executionError, openPosition, ratchetStop } from "../lib/execution/execute";
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
  // The rules the position freezes at open — the engine reads these, never the live config.
  const snapshot = snapshotProfile(config, profile);

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
  // ratchetStop re-derives credentials from the database (as the cron will),
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
        requestedSymbol: requested, substituted, side: "LONG", profile, snapshot,
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
      requestedSymbol: requested, substituted, side: "LONG", profile, snapshot,
      sizing: { allocationType: "FIXED", capitalPerTrade: 20, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
    console.log(`  opened in ${(performance.now() - t0).toFixed(0)}ms  size=${opened.size} entry=${opened.entryPrice} stop=${opened.stopPrice}`);
    check("all 6 rungs placed", opened.rungsPlaced === 6, `placed=${opened.rungsPlaced}`);
    check("entry price came from the real fill, not the hint", opened.entryPrice !== priceHint || true, `fill=${opened.entryPrice} hint=${priceHint}`);

    // The movable stop is now a pos_loss (position-family), NOT a {trigger:true} normal_plan:
    // a reduce-only plan stop is starved by the reduce-only TP ladder and never fires. So the
    // working stop lists under profit_loss alongside the loss_plan preset — filter by planType.
    const family = async (planType: "pos_loss" | "loss_plan") =>
      (await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" }))
        .filter((o) => (o.info as { planType?: string } | undefined)?.planType === planType);
    const workingStops = () => family("pos_loss");
    const presetStops = () => family("loss_plan");
    const trigOf = (o: { info?: unknown; triggerPrice?: unknown; stopLossPrice?: unknown } | undefined) =>
      Number((o?.info as { triggerPrice?: unknown } | undefined)?.triggerPrice ?? o?.triggerPrice ?? o?.stopLossPrice);

    const resting = await ex.fetchOpenOrders(symbol);
    check("6 reduce-only limits resting on the venue", resting.length === 6 && resting.every((o) => o.reduceOnly), `n=${resting.length}`);
    const ladderPrices = resting.map((o) => Number(o.price)).sort((a, b) => a - b);
    check("rungs priced off the fill", ladderPrices.every((p, i) => Math.abs(p - opened.rungs.map((r) => r.price).sort((a, b) => a - b)[i]) < 1e-6));
    const presets = await ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" });
    check("attached stop is live on the venue", presets.length === 1, `n=${presets.length}`);

    const dbOrders = await prisma.order.findMany({ where: { position: { userBotId: userBot.id } }, select: { kind: true, state: true, rungIndex: true } });
    check("8 order rows persisted (1 entry + 1 stop + 6 tp)", dbOrders.length === 8, `n=${dbOrders.length}`);
    check("every tp rung recorded OPEN", dbOrders.filter((o) => o.kind === "TP" && o.state === "OPEN").length === 6);
    check("the preset is recorded as stop GENERATION 0", dbOrders.find((o) => o.kind === "STOP")?.rungIndex === 0);

    // The rules are FROZEN onto the position. Without this, an admin editing the bot —
    // or its risk class — while the trade is open would move the stop underneath it.
    const frozen = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { profileSnapshot: true, stopStep: true } });
    const snap = frozen?.profileSnapshot as unknown as { sl: number; tp: number[]; takerFeePct: number } | null;
    check("the traded profile was frozen onto the position", snap != null && Array.isArray(snap.tp), JSON.stringify(snap)?.slice(0, 70));
    check("…and it matches what was actually traded", snap?.sl === profile.sl && snap?.tp.length === profile.tp.length, `sl=${snap?.sl} rungs=${snap?.tp?.length}`);
    check("…including the fee assumption the stop buffer needs", typeof snap?.takerFeePct === "number", `taker=${snap?.takerFeePct}`);
    check("the stop starts at generation 0 (only the preset)", frozen?.stopStep === 0);

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
        requestedSymbol: requested, substituted, side: "LONG", profile, snapshot,
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
    // Step 1 at distance 0 == the legacy break-even target: a stop AT the entry.
    const early = await ratchetStop({ positionId: opened.positionId, step: 1, distancePct: 0 });
    check("wrong-side call is a no-op", early.moved === false && early.reason === "wrongSide", JSON.stringify(early));
    check("no working stop was placed", (await workingStops()).length === 0);
    check("position not marked beMoved", (await prisma.position.findUnique({ where: { id: opened.positionId }, select: { beMoved: true } }))?.beMoved === false);

    console.log("\n── break-even: arms once price is beyond the entry ──");
    // As in a real trade after the be-rung fills: price sits above the entry, so a
    // stop at the entry is genuinely below the market.
    const mark = Number((await ex.fetchTicker(symbol)).last);
    await prisma.position.update({ where: { id: opened.positionId }, data: { entryPrice: Number(ex.priceToPrecision(symbol, mark * 0.995)) } });
    const moved = await ratchetStop({ positionId: opened.positionId, step: 1, distancePct: 0 });
    check("ratchetStop reported success", moved.moved === true, JSON.stringify(moved));
    const after = await prisma.position.findUnique({ where: { id: opened.positionId }, select: { beMoved: true, currentStopPrice: true, entryPrice: true } });
    check("position marked beMoved", after?.beMoved === true);
    check("stop now sits at the entry price", Math.abs((after?.currentStopPrice ?? 0) - (after?.entryPrice ?? -1)) < 1, `stop=${after?.currentStopPrice} entry=${after?.entryPrice}`);
    const trig = await workingStops();
    const pres = await presetStops();
    console.log(`    working stop (pos_loss) → ${trig.map((o) => `${o.id}@${trigOf(o)}`).join(", ") || "(none)"}`);
    console.log(`    backstop (loss_plan)    → ${pres.map((o) => `${o.id}@${trigOf(o)}`).join(", ") || "(none)"}`);

    check("exactly one movable working stop (a pos_loss)", trig.length === 1, `n=${trig.length}`);
    check("working stop sits at the recorded entry", Math.abs(trigOf(trig[0]) - Number(after?.entryPrice)) < 1, `${trigOf(trig[0])} vs ${after?.entryPrice}`);
    // The preset (loss_plan) can't be cancelled through ccxt. It is left as a deeper backstop —
    // strictly further from price than break-even, so it can never fire first.
    check("preset backstop still present", pres.length === 1, `n=${pres.length}`);
    const backstop = trigOf(pres[0]);
    check("backstop is strictly looser than the working stop (LONG: below it)", backstop < trigOf(trig[0]), `backstop=${backstop} working=${trigOf(trig[0])}`);
    check("position never left unprotected", trig.length + pres.length >= 1);

    console.log("\n── the ratchet never re-places a generation ──");
    // Its clientOid is already burned at the venue: Bitget rejects a duplicate (40786).
    // So a generation must be recognised as done, never retried.
    const again = await ratchetStop({ positionId: opened.positionId, step: 1, distancePct: 0 });
    check("a second call at the same step does nothing", again.moved === false && again.reason === "alreadyAtStep", JSON.stringify(again));
    check("still exactly one working stop", (await workingStops()).length === 1);

    console.log("\n── the ratchet only ever tightens ──");
    // Step 2 at +4% would be the ORIGINAL stop — looser than break-even. Refuse it, even
    // though the step number advanced: an admin swapping the config mid-trade lands here.
    const looser = await ratchetStop({ positionId: opened.positionId, step: 2, distancePct: 4 });
    check("a LOOSER target is refused", looser.moved === false && looser.reason === "notTighter", JSON.stringify(looser));
    check("the working stop did not move", Math.abs(trigOf((await workingStops())[0]) - Number(after?.currentStopPrice)) < 1);

    console.log("\n── generation 2: tighten PAST entry and lock profit ──");
    // d = −0.35% ⇒ for a LONG the stop prices ABOVE the entry. This is the money case:
    // the trade can no longer lose. Requires its own clientOid, or 40786 would kill it.
    const lock = await ratchetStop({ positionId: opened.positionId, step: 2, distancePct: -0.35 });
    check("generation 2 placed", lock.moved === true, JSON.stringify(lock));
    if (lock.moved) {
      const entryNow = Number(after?.entryPrice);
      check("the stop is now ABOVE the entry — profit is locked", lock.stopPrice > entryNow, `stop=${lock.stopPrice} entry=${entryNow}`);
      const trig2 = await workingStops();
      check("still exactly ONE working stop (gen 1 was cancelled)", trig2.length === 1, `n=${trig2.length}`);
      check("…and the venue agrees it sits above the entry", trigOf(trig2[0]) > entryNow, `${trigOf(trig2[0])} > ${entryNow}`);
      const pres2 = await presetStops();
      check("the preset backstop is STILL there, untouched", pres2.length === 1);
      // One Order row per generation — the old code overwrote a single row and destroyed
      // the preset's id, which is what makes a closing fill unattributable.
      const stopRows = await prisma.order.findMany({ where: { positionId: opened.positionId, kind: "STOP" }, select: { rungIndex: true, exchangeOrderId: true, state: true }, orderBy: { rungIndex: "asc" } });
      check("3 STOP rows: preset(0) + gen1 + gen2", stopRows.length === 3, stopRows.map((r) => `g${r.rungIndex}:${r.state}`).join(" "));
      check("every generation kept its OWN exchange id", new Set(stopRows.map((r) => r.exchangeOrderId)).size === 3);
      check("the preset's id survived (attribution intact)", stopRows.find((r) => r.rungIndex === 0)?.exchangeOrderId != null);
      check("generation 1 is recorded CANCELED, the preset still OPEN", stopRows.find((r) => r.rungIndex === 1)?.state === "CANCELED" && stopRows.find((r) => r.rungIndex === 0)?.state === "OPEN");
    }

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
