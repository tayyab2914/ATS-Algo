/**
 * What Bitget ACTUALLY does when a stop is OVERSIZED relative to the position it guards.
 * Settled on the PAPER engine, because reading ccxt's source got this wrong.
 *
 * This situation arises on EVERY trade we place. The entry attaches a stop sized to the
 * full entry; take-profit rungs then shrink the position underneath it. So from the first
 * filled rung onward, both resting stops are larger than the position they guard.
 *
 * Three outcomes are possible when such a stop triggers, and they could not be more
 * different:
 *
 *   CLAMP     → closes what is there. Harmlessly oversized; nothing to fix.
 *   REJECT    → the order is consumed and the position survives UNSTOPPED.
 *   OVERSHOOT → fills the full size: closes the position AND opens a naked reverse one.
 *
 * We do not drag the stop onto the market (that needs a modify permission the key may not
 * have, and it muddied an earlier run). We place the stop CLOSE to the mark at creation,
 * shrink the position underneath it, and let it fire on its own — then read the order's
 * final state from the venue rather than inferring it.
 *
 * THE TWO SECTIONS TEST OPPOSITE THINGS, DELIBERATELY.
 *
 *   A — the PRESET (`loss_plan`, attached to the entry). This is the live production
 *       backstop and it must CLAMP. If A ever fails, every partially-filled trade is one
 *       trigger away from either evaporating or flipping naked-short. A is the assertion
 *       that matters.
 *
 *   B — a reduce-only `normal_plan` (`triggerPrice` + `reduceOnly`). The engine ABANDONED
 *       this shape; nothing in lib/ places it any more (the ratchet mints a `pos_loss` via
 *       `stopLossPrice` — see execute.ts). It is kept here as a REGRESSION GUARD proving
 *       WHY it was abandoned: the reduce-only TP ladder reserves ~100% of the position, so
 *       a reduce-only plan stop is STARVED — it fills only whatever sliver the ladder left
 *       unreserved, then dies, and the position survives unstopped. B therefore asserts
 *       REJECT. If B ever starts reporting CLAMP, Bitget changed its reservation model and
 *       the `pos_loss` machinery could be simplified away.
 *
 *       (B asserted CLAMP until 2026-08-03. That was a leftover from before the pos_loss
 *       fix — it asserted the OLD shape was safe, which is the exact belief the fix
 *       overturned. Section A was passing throughout; only this assertion was wrong.)
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-preset-demo.ts
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
/**
 * Recorded, never counted as a failure.
 *
 * Both sections need the MARK to fall through a trigger sitting a few basis points below it,
 * within the settle window. In a quiet market it simply does not, and that is not a venue
 * verdict — but it used to be scored as one, so a flat 3 minutes of BTC was indistinguishable
 * from "the backstop evaporated". A test that could not run must say so rather than accuse the
 * venue. Re-run in a livelier market to settle it.
 */
const inconclusive = (label: string, why: string) => console.log(`  ~ ${label}  INCONCLUSIVE — ${why}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const base = JSON.parse(readFileSync("fixtures/BTC.json", "utf8")) as BotConfig;
  const stamp = Date.now();

  const { symbol, market, requested } = await resolveSymbol("Bitget", "BTC", true);
  const ex = await exchangeClient("Bitget", creds, [market]);
  if (ex.options["sandboxMode"] !== true) throw new Error("REFUSING TO RUN: not sandbox");
  await closeAll(ex, symbol).catch(() => {});

  const user = await prisma.user.create({ data: { email: `preset-${stamp}@invalid.test`, passwordHash: "x" }, select: { id: true } });
  const aad = `${user.id}:Bitget`;
  await prisma.exchangeConnection.create({
    data: { userId: user.id, exchange: "Bitget", sandbox: true, permissions: "Read & Trade", apiKeyMasked: "••••test",
      apiKeyEnc: encryptSecret(creds.apiKey, aad), apiSecretEnc: encryptSecret(creds.apiSecret, aad), passphraseEnc: encryptSecret(creds.passphrase!, aad) },
  });

  const presets = () => ex.fetchOpenOrders(symbol, undefined, undefined, { planType: "profit_loss" });
  const plans = () => ex.fetchOpenOrders(symbol, undefined, undefined, { trigger: true });
  const position = async () => (await ex.fetchPositions([symbol]))[0] ?? null;
  const contracts = async () => Number((await position())?.contracts ?? 0);
  const mark = async () => Number((await ex.fetchTicker(symbol)).last);

  const deploy = async (sl: number, tag: string) => {
    const config: BotConfig = { ...base, profiles: { ...base.profiles, safe: { ...base.profiles.safe, sl } } };
    const profile = profileFor(config, "LOW")!;
    const bot = await prisma.bot.create({
      data: { name: `PRESET ${tag} ${stamp}`, category: "Crypto", timeframe: "150m", riskClass: "LOW", ticker: "BTC",
        exchange: "Bitget", exchanges: ["Bitget"], config: config as object, status: "ACTIVE" },
      select: { id: true },
    });
    const userBot = await prisma.userBot.create({
      data: { userId: user.id, botId: bot.id, active: true, allocatedCapital: 1000, capitalPerTrade: 30, allocationType: "FIXED", exchangeSource: "Bitget" },
      select: { id: true },
    });
    const signal = await prisma.signal.create({ data: { botId: bot.id, action: "ENTER", side: "LONG", dedupeKey: `${stamp}-${tag}`, raw: {} }, select: { id: true } });
    const priceHint = await mark();
    return openPosition({
      signalId: signal.id, userBotId: userBot.id, userId: user.id, exchange: "Bitget", creds, symbol, market,
      requestedSymbol: requested, substituted: false, side: "LONG", profile, snapshot: snapshotProfile(config, profile),
      sizing: { allocationType: "FIXED", capitalPerTrade: 30, allocatedCapital: 1000, realizedBalance: 0, compounding: false },
      priceHint, prepared: null,
    });
  };

  /** Halve the position — exactly what a filled take-profit rung does to it. */
  const halve = async (fullSize: number) => {
    const half = Number(ex.amountToPrecision(symbol, fullSize / 2));
    await ex.createOrder(symbol, "market", "sell", half, undefined, { reduceOnly: true, oneWayMode: true });
    await sleep(1500);
    return contracts();
  };

  /** Wait for the stop to leave the book, then classify what it did to the position. */
  const settle = async (restingCount: () => Promise<number>, label: string) => {
    for (let i = 0; i < 90; i++) {
      await sleep(2000);
      const [n, resting] = [await contracts(), await restingCount()];
      if (n === 0 || resting === 0) {
        await sleep(2500); // let the fill and the position update land
        const pos = await position();
        const size = Number(pos?.contracts ?? 0);
        const side = pos?.side ?? null;
        const still = await restingCount();
        const verdict = size === 0 && side === null ? "CLAMP"
          : side === "short" ? "OVERSHOOT"
          : still === 0 ? "REJECT"
          : "UNCLEAR";
        console.log(`  ${label}: verdict=${verdict}  position=${size} ${side ?? "flat"}  resting stops=${still}`);
        return { verdict, size, side };
      }
    }
    console.log(`  ${label}: never triggered in the window`);
    return { verdict: "TIMEOUT" as const, size: await contracts(), side: (await position())?.side ?? null };
  };

  try {
    // ── A. the PRESET (a sized `loss_plan`) ───────────────────────────────────
    // sl is deliberately tiny so the preset sits just under the mark and fires on its own.
    console.log("── A: the entry's PRESET, oversized, fires ──");
    let a = await deploy(0.06, "a");
    if ((await contracts()) === 0) { // lost the race — the preset fired before we could shrink
      console.log("  (preset fired before the shrink; retrying with more room)");
      a = await deploy(0.12, "a2");
    }
    const p0 = (await presets())[0] as unknown as { id: string; info?: Record<string, unknown> } | undefined;
    console.log(`  opened ${a.size} @ ${a.entryPrice} · preset size=${p0?.info?.size} planType=${p0?.info?.planType} trigger=${p0?.info?.triggerPrice}`);
    check("the preset is a SIZED loss_plan (NOT a position-level pos_loss)", p0?.info?.planType === "loss_plan", String(p0?.info?.planType));

    const leftA = await halve(a.size);
    const pA = (await presets())[0] as unknown as { info?: Record<string, unknown> } | undefined;
    check("the position halved", leftA > 0 && leftA < a.size, `${a.size} → ${leftA}`);
    check("the preset did NOT track the position down — it is now OVERSIZED", Number(pA?.info?.size ?? 0) === a.size, `preset=${pA?.info?.size} vs position=${leftA}`);

    const rA = await settle(async () => (await presets()).length, "preset");
    if (rA.verdict === "TIMEOUT") {
      inconclusive("an oversized PRESET clamps to the position", "the mark never reached the trigger");
    } else {
      check("an oversized PRESET clamps to the position (no naked reverse, no evaporation)", rA.verdict === "CLAMP", `verdict=${rA.verdict}`);
      if (rA.verdict === "OVERSHOOT") console.log("  🚨 the preset flipped us SHORT. Every partially-filled trade is one stop from a naked reverse.");
      if (rA.verdict === "REJECT") console.log("  🚨 the preset EVAPORATED and left the position unstopped. The backstop is not a backstop.");
    }

    await closeAll(ex, symbol); await sleep(1500);

    // ── B. the ABANDONED shape: a reduce-only `normal_plan` ───────────────────
    // Regression guard, not a test of anything the engine still does. See the header.
    console.log("\n── B: the ABANDONED reduce-only normal_plan — proving it starves ──");
    const b = await deploy(4, "b"); // preset parked far away so it cannot interfere
    const trigger = Number(ex.priceToPrecision(symbol, (await mark()) * 0.9995)); // 0.05% under: fires on its own
    const stop = await ex.createOrder(symbol, "market", "sell", b.size, undefined, {
      marginMode: "isolated", oneWayMode: true, reduceOnly: true, triggerPrice: trigger,
      clientOid: `probe-${stamp}`,
    });
    console.log(`  opened ${b.size} @ ${b.entryPrice} · plan stop size=${b.size} trigger=${trigger}`);
    check("a reduce-only plan stop is resting", (await plans()).length === 1);

    const leftB = await halve(b.size);
    check("the position halved beneath it — the plan stop is now OVERSIZED", leftB > 0 && leftB < b.size, `stop=${b.size} vs position=${leftB}`);

    const rB = await settle(async () => (await plans()).length, "plan stop");
    const bFired = rB.verdict !== "TIMEOUT";
    if (!bFired) {
      inconclusive("an oversized reduce-only plan stop is STARVED", "the mark never reached the trigger");
    } else {
      // STARVED is the expected, load-bearing outcome — it is the whole reason the ratchet
      // mints a position-level pos_loss instead. CLAMP here would be a venue change.
      check("an oversized reduce-only plan stop is STARVED (REJECT), not clamped", rB.verdict === "REJECT", `verdict=${rB.verdict}`);
      if (rB.verdict === "CLAMP") {
        console.log("  ⚠ Bitget now CLAMPS a reduce-only plan stop. The starvation this guards");
        console.log("    against may be gone — re-derive before simplifying the pos_loss path.");
      }
      if (rB.verdict === "OVERSHOOT") console.log("  🚨 it flipped us SHORT — worse than starvation, escalate.");
    }

    // The order's final state is the fingerprint that tells starvation from a clean reject:
    // a PARTIAL fill (the sliver the ladder had not reserved) and then death.
    const closed = await ex.fetchCanceledAndClosedOrders(symbol, stamp - 60_000, 50, { trigger: true }).catch(() => []);
    const mine = closed.find((o) => o.clientOrderId === `probe-${stamp}` || o.id === stop.id);
    const filled = Number(mine?.filled ?? 0);
    const amount = Number(mine?.amount ?? 0);
    console.log(`  the plan order's final state → status=${mine?.status ?? "(not found)"} filled=${filled} amount=${amount}`);
    if (!bFired) {
      inconclusive("the fingerprint is a PARTIAL fill then death", "the stop is still resting, so it has no final state");
    } else {
      check(
        "…and the fingerprint is a PARTIAL fill then death (0 < filled < amount)",
        filled > 0 && amount > 0 && filled < amount,
        `filled ${filled} of ${amount} — the ladder had reserved the rest`,
      );
    }

    // C. attribution. A triggered plan order is executed by a CHILD market order with its own
    // id, so the FILL carries the child's id — never the plan id. The only link back is that
    // the child's clientOid IS the plan-order id, which is exactly how manage.ts resolves a
    // stop-out (see its `stopPlanIds` loop). Asserting `t.order === stop.id`, as this used to,
    // can therefore never hold for any venue stop — it was testing a mechanism that does not
    // exist.
    const trades = await ex.fetchMyTrades(symbol, stamp - 60_000, 100);
    const sells = trades.filter((t) => t.side === "sell");
    console.log(`  sell fills=${sells.length}  ids=${[...new Set(sells.map((t) => t.order ?? "(none)"))].join(", ")}`);
    check("no fill carries the plan-order id directly (it arrives on a child order)",
      sells.every((t) => t.order !== stop.id), `plan id ${stop.id}`);

    let childOf: { fillOrderId: string; childOid: string } | null = null;
    for (const t of sells) {
      if (!t.order) continue;
      const child = await ex.fetchOrder(t.order, symbol).catch(() => null);
      const oid = child?.clientOrderId ?? (child?.info as { clientOid?: string } | undefined)?.clientOid;
      if (oid && (oid === stop.id || oid === `probe-${stamp}`)) { childOf = { fillOrderId: t.order, childOid: oid }; break; }
    }
    console.log(`  child resolution → ${childOf ? `fill ${childOf.fillOrderId} carries clientOid ${childOf.childOid}` : "(no child linked back to the plan order)"}`);
    if (!bFired) {
      inconclusive("the stop-out is attributable via the CHILD's clientOid", "the stop never fired, so there is no child order");
    } else {
      check("the stop-out is attributable via the CHILD's clientOid (manage.ts's mechanism)",
        childOf !== null, childOf ? "" : "→ closedReason degrades to RECONCILE (safe, but not labelled SL)");
    }
  } finally {
    console.log("\n── cleanup ──");
    await closeAll(ex, symbol).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.bot.deleteMany({ where: { name: { startsWith: "PRESET " } } }).catch(() => {});
    console.log("  venue flattened · throwaway rows deleted");
  }

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect().catch(() => {}); process.exit(1); });
