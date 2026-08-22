// The BingX stop questions that decide whether its ratchet is safe. Real orders, VST demo
// engine, everything through ccxt's UNIFIED api.
//
// Four venues, four different stop models so far, so nothing here is assumed from the other
// three:
//
//   A. WHERE does the entry-attached stop live, and does it have its own id? (Bitget: a
//      separate uncancellable loss_plan. Bybit: a sizeless position attribute. BloFin: an
//      ordinary cancellable TPSL in the same family as the ratchet's.)
//   B. Do stops STACK or OVERWRITE? That decides cancel-first (Bitget/BloFin) vs overwrite-in-
//      place (Bybit), and picking wrong is unsafe rather than merely wrong.
//   C. THE ONE THAT DECIDES THE VENUE: does a sized reduce-only stop STARVE behind a full-size
//      reduce-only TP ladder? Bitget's does — it filled 0.0001 of 0.0018 and died, leaving the
//      position open. BloFin's does not. BingX's stop is a real reduce-only order like both, so
//      it could go either way.
//   D. Does a bare `cancelAllOrders(symbol)` take the backstop with it? (The Bybit failure:
//      proven there, and it dictates whether closeAll must close BEFORE it sweeps.)
//   E. BINGX-ONLY: ccxt never writes `reduceOnly` into a bingx request — bingx.js:3144 sets a
//      LOCAL flag that only steers `positionSide` in hedge mode. So a stop minted via
//      `stopLossPrice` goes out as a PLAIN STOP_MARKET. If one fires while the position is
//      already flat, does it OPEN a naked short?
//
// ⚠ Places real orders on open-api-vst.bingx.com and SETS the demo account's per-symbol margin
//   mode + leverage. That is test-fixture setup. It does NOT set position mode: that is
//   account-global on this venue and the engine's policy is check-don't-change, so the probe
//   refuses to run unless the account is already one-way. Cleans up in a finally.
//
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/probe-bingx-stops.ts
import "dotenv/config";
import ccxt, { type Exchange, type MarketInterface, type Order } from "ccxt";
import { exchangeClient, livePosition, type TradeCreds } from "../lib/execution/client";

const VENUE = "Bingx";
const SYMBOL = "BTC/USDT:USDT";
const LEVERAGE = 5;
const MARGIN = "isolated";
/** Base units — BingX contractSize is 1. Big enough that a halved ladder leg clears min cost. */
const SIZE = 0.004;
const TRIGGER_GAP = 0.0002;
const ATTEMPT_MS = 130_000;
const SIDES: ("LONG" | "SHORT")[] = ["LONG", "SHORT", "LONG", "SHORT", "LONG", "SHORT"];

const creds: TradeCreds = {
  apiKey: process.env.BINGX_DEMO_KEY ?? "",
  apiSecret: process.env.BINGX_DEMO_SECRET ?? "",
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

const fmt = (orders: Order[]) =>
  orders.map((o) => {
    const i = (o.info ?? {}) as Record<string, unknown>;
    return `${String(o.id).slice(0, 12)}|${i.type ?? o.type}|${o.side}|amt=${o.amount ?? "-"}|trig=${String(i.stopPrice ?? i.triggerPrice ?? "-")}|ro=${JSON.stringify(i.reduceOnly)}`;
  });

/**
 * Both enumerations, plus the DEDUPED union.
 *
 * On BingX `plain` and `trigger` hit the SAME endpoint (`swap/v2/trade/openOrders`) and return
 * the SAME rows — `trigger: true` is not even a recognised filter, it just rides along in the
 * query string. So counting `plain.length + trigger.length` double-counts every order, which is
 * exactly the mistake that made the first run of test B report 2 stops as 4.
 */
async function families(ex: Exchange) {
  const plain = await ex.fetchOpenOrders(SYMBOL).catch(() => [] as Order[]);
  const trigger = await ex.fetchOpenOrders(SYMBOL, undefined, undefined, { trigger: true }).catch(() => [] as Order[]);
  const byId = new Map<string, Order>();
  for (const o of [...plain, ...trigger]) if (o.id) byId.set(o.id, o);
  const all = [...byId.values()];
  return { plain, trigger, all, stops: all.filter((o) => String(((o.info ?? {}) as Record<string, unknown>).type ?? "").includes("STOP")) };
}

/** Cancel by explicit id — never the blanket sweep, which is the thing under test in D. */
async function cancelEverything(ex: Exchange) {
  for (const o of (await families(ex)).all) {
    if (o.id) await ex.cancelOrder(o.id, SYMBOL).catch(() => {});
  }
}

async function flatten(ex: Exchange) {
  await cancelEverything(ex);
  const live = await livePosition(ex, SYMBOL);
  const contracts = Number(live?.contracts ?? 0);
  if (contracts > 0) {
    await ex
      .createOrder(SYMBOL, "market", live?.side === "long" ? "sell" : "buy", contracts, undefined, { reduceOnly: true })
      .catch((e) => note("flatten failed", String(e).slice(0, 130)));
  }
  await sleep(2000);
  // A stop can outlive the position it was attached to — sweep again once flat.
  await cancelEverything(ex);
  await sleep(800);
}

/** The VST market descriptor, read from the venue. No database involved. */
async function loadMarket(): Promise<MarketInterface | undefined> {
  const pub = new ccxt.bingx({ enableRateLimit: true, timeout: 20_000, options: { defaultType: "swap" } });
  pub.setSandboxMode(true);
  pub.has["fetchCurrencies"] = false;
  await pub.loadMarkets();
  return pub.markets[SYMBOL] as MarketInterface | undefined;
}

async function main() {
  if (!creds.apiKey || !creds.apiSecret) throw new Error("BINGX_DEMO_KEY / BINGX_DEMO_SECRET missing from .env");
  // Straight from the venue, NOT via `getMarket` — that reads the `market_cache` table, and a
  // venue probe must not need a database to answer a question about the exchange.
  const market = await loadMarket();
  if (!market) throw new Error(`VST does not list ${SYMBOL}`);
  const ex = await exchangeClient(VENUE, creds, [market]);
  if (!JSON.stringify(ex.urls.api).includes("open-api-vst")) throw new Error("REFUSING TO RUN: not the VST host");
  console.log(`open-api-vst · ${SYMBOL} · contractSize ${market.contractSize}\n`);

  const price = (n: number) => Number(ex.priceToPrecision(SYMBOL, n));
  const amount = (n: number) => Number(ex.amountToPrecision(SYMBOL, n));

  // ── fixture setup ─────────────────────────────────────────────────────────
  console.log("── fixture: one-way (checked, never set) + isolated + leverage ──");
  const hedged = await ex.fetchPositionMode(SYMBOL).then((m) => m.hedged, () => null);
  check("account is ONE-WAY", hedged === false, `hedged=${hedged}`);
  if (hedged !== false) {
    // Deliberately fatal. Position mode is account-global here, so the probe will not flip it —
    // and every result below would be meaningless in hedge mode anyway (a "reversal" would open
    // a second position and the stop would bind to the wrong side).
    throw new Error("ACCOUNT IS IN HEDGE MODE — switch to One-way in the BingX UI, then re-run");
  }
  await ex.setMarginMode(MARGIN, SYMBOL).then(() => check("margin mode isolated", true), (e) => note("setMarginMode", String(e).slice(0, 100)));
  // `side` is MANDATORY on this venue — ccxt throws ArgumentsRequired without it.
  await ex.setLeverage(LEVERAGE, SYMBOL, { side: "BOTH" }).then(() => check(`leverage ${LEVERAGE}`, true), (e) => note("setLeverage", String(e).slice(0, 100)));

  try {
    // ══ A · where does the entry-attached stop live? ═════════════════════════
    console.log("\n══ A · the entry-attached stop: where, what id, what size? ══");
    await flatten(ex);
    const mark0 = Number((await ex.fetchTicker(SYMBOL)).last);
    note("mark", mark0);
    const backstop = price(mark0 * 0.9);
    await ex.createOrder(SYMBOL, "market", "buy", SIZE, undefined, {
      clientOrderId: `bx${Date.now().toString(36)}`,
      stopLoss: { triggerPrice: backstop },
    });
    await sleep(2500);
    let pos = await livePosition(ex, SYMBOL);
    note("position", `${pos?.contracts} contracts`);
    note("position.info.stopLoss-ish", JSON.stringify((pos?.info as Record<string, unknown>)?.stopLoss ?? "(absent)").slice(0, 160));
    let fam = await families(ex);
    note("plain", fmt(fam.plain).join("  ") || "(none)");
    note("trigger:true", fmt(fam.trigger).join("  ") || "(none)");
    note("deduped union", `${fam.all.length} order(s), of which ${fam.stops.length} are stops`);
    const sameSet = fam.plain.length === fam.trigger.length && fam.all.length === fam.plain.length;
    answer("A-enumeration", sameSet
      ? "plain and {trigger:true} return the SAME rows — ONE order family on this venue, so `trigger` is not a filter and counts must be deduped"
      : "the two enumerations differ — there are genuinely separate families");
    const attachedVisible = fam.all.length > 0;
    answer("A", attachedVisible
      ? `the attached stop IS a discoverable ORDER (${fam.stops.length} stop row) — BloFin-like, cancellable, with its own id`
      : "the attached stop is NOT an order — it is a position attribute (Bybit-like) or invisible to both enumerations");
    check("the position is protected by something we can find", attachedVisible || Boolean((pos?.info as Record<string, unknown>)?.stopLoss));

    // ══ B · stack or overwrite? ═════════════════════════════════════════════
    console.log("\n══ B · does a second stop STACK or OVERWRITE? ══");
    const before = (await families(ex)).stops.length;
    pos = await livePosition(ex, SYMBOL);
    const held = amount(Number(pos?.contracts ?? SIZE));
    const tight = price(Number(pos?.markPrice ?? mark0) * 0.97);
    // Sizeless first — Bybit's Full-mode shape. If accepted it would track the position down.
    const sizeless = await ex
      .createOrder(SYMBOL, "market", "sell", 0, undefined, { stopLossPrice: tight, reduceOnly: true })
      .then((o) => ({ ok: true as const, o }), (e) => ({ ok: false as const, msg: String(e).slice(0, 150) }));
    answer("B-sizeless", sizeless.ok ? `ACCEPTED, id ${sizeless.o.id}` : `REJECTED — a stop must be SIZED: ${sizeless.msg}`);

    const sized = await ex
      .createOrder(SYMBOL, "market", "sell", held, undefined, { stopLossPrice: tight, reduceOnly: true })
      .then((o) => ({ ok: true as const, o }), (e) => ({ ok: false as const, msg: String(e).slice(0, 150) }));
    answer("B-sized", sized.ok ? `ACCEPTED, id ${sized.o.id}` : `REJECTED: ${sized.msg}`);
    await sleep(2500);
    fam = await families(ex);
    const after = fam.stops.length;
    note("stops now (deduped)", fmt(fam.stops).join("  ") || "(none)");
    answer("B", after > before
      ? `STACKED — ${after} stops rest (was ${before}), so the ratchet MUST cancel-first, like Bitget/BloFin`
      : `REPLACED in place — ${after} rests (was ${before}), so the ratchet overwrites, like Bybit`);

    // ══ D · does a bare sweep take the backstop? ════════════════════════════
    console.log("\n══ D · what does a bare cancelAllOrders(symbol) actually remove? ══");
    // Put a resting LIMIT leg alongside the stops first. Without one this test can only say
    // whether stops survive — and the answer that matters for closeAll is whether the sweep
    // clears the reduce-only LADDER, which the market close would otherwise fight.
    const heldBeforeSweep = amount(Number((await livePosition(ex, SYMBOL))?.contracts ?? 0));
    const markD = Number((await ex.fetchTicker(SYMBOL)).last);
    await ex
      .createOrder(SYMBOL, "limit", "sell", heldBeforeSweep, price(markD * 1.08), { reduceOnly: true, clientOrderId: `bd${Date.now().toString(36)}` })
      .then((o) => note("decoy ladder leg", o.id), (e) => note("decoy leg rejected", String(e).slice(0, 130)));
    await sleep(2000);
    const beforeSweep = await families(ex);
    const limitsBefore = beforeSweep.all.length - beforeSweep.stops.length;
    note("before the sweep", `${beforeSweep.stops.length} stop(s) + ${limitsBefore} limit(s)`);

    for (const params of [{}, { trigger: true }]) {
      await ex.cancelAllOrders(SYMBOL, params).catch((e) => note(`cancelAllOrders ${JSON.stringify(params)}`, String(e).slice(0, 100)));
    }
    await sleep(2500);
    fam = await families(ex);
    const posAfterSweep = await livePosition(ex, SYMBOL);
    const limitsAfter = fam.all.length - fam.stops.length;
    const attrLeft = (posAfterSweep?.info as Record<string, unknown>)?.stopLoss;
    note("after the sweep", `${fam.stops.length} stop(s) + ${limitsAfter} limit(s)`);
    note("position after the sweep", `${posAfterSweep?.contracts ?? 0} contracts`);
    const stopsSurvive = fam.stops.length >= beforeSweep.stops.length && beforeSweep.stops.length > 0;
    const limitsCleared = limitsBefore > 0 && limitsAfter === 0;
    answer("D-backstop", stopsSurvive
      ? "the bare sweep does NOT remove stops — the backstop survives it, so closeAll may sweep first (the Bitget/BloFin ordering)"
      : `stops were REMOVED by the bare sweep (${beforeSweep.stops.length} → ${fam.stops.length}) — closeAll MUST close BEFORE sweeping (the Bybit rule)`);
    answer("D-ladder", limitsCleared
      ? "the bare sweep DOES clear resting reduce-only limits — the ladder is removed as intended"
      : `⚠ the bare sweep left ${limitsAfter} limit(s) behind (was ${limitsBefore}) — the ladder must be cancelled BY ID or the market close fights it`);
    check("the bare-sweep question was answered on a real open position", heldBeforeSweep > 0, `held=${heldBeforeSweep}`);
    const nakedNow = Number(posAfterSweep?.contracts ?? 0) > 0 && fam.stops.length === 0 && !attrLeft;
    check("the sweep did NOT leave the position naked", !nakedNow, nakedNow ? "NAKED — no stop of any kind remains" : "");

    // ══ E · does an unflagged stop open a naked short when it fires flat? ════
    console.log("\n══ E · a STOP_MARKET left behind while FLAT — does it open a position? ══");
    await flatten(ex);
    const markE = Number((await ex.fetchTicker(SYMBOL)).last);
    // No reduceOnly, exactly as ccxt mints it via stopLossPrice, and a hair BELOW the mark so an
    // ordinary tick takes it — with no position to reduce.
    const trigE = price(markE * (1 - TRIGGER_GAP));
    const strayOk = await ex
      .createOrder(SYMBOL, "market", "sell", amount(SIZE), undefined, { stopLossPrice: trigE })
      .then(() => true, (e) => { note("stray stop rejected while flat", String(e).slice(0, 150)); return false; });
    if (!strayOk) {
      answer("E", "SAFE BY THE VENUE — a stop cannot even be placed while flat, so a stray stop cannot open anything");
    } else {
      note("stray stop armed at", `${trigE} (mark ${markE}, flat)`);
      const deadlineE = Date.now() + 60_000;
      let opened = 0;
      while (Date.now() < deadlineE) {
        await sleep(4000);
        opened = Number((await livePosition(ex, SYMBOL))?.contracts ?? 0);
        if (opened > 0) break;
        const still = (await families(ex)).all.length;
        if (still === 0) break; // it fired and did nothing, or was reaped
      }
      answer("E", opened > 0
        ? `⛔ YES — a stray unflagged stop OPENED ${opened} contracts from flat. Every stop this engine mints on BingX MUST carry reduceOnly:true.`
        : "no position appeared in the window — either it never triggered, or the venue dropped it. Re-run if inconclusive.");
      check("no naked position was opened by a stray stop", opened === 0, `contracts=${opened}`);
    }

    // ══ C · STARVATION — the one that decides the model ═════════════════════
    console.log("\n══ C · does a sized reduce-only stop STARVE behind a full reduce-only ladder? ══");
    let fired = false;
    let verdict = "";
    for (const side of SIDES) {
      await flatten(ex);
      const isLong = side === "LONG";
      const exitSide = isLong ? "sell" : "buy";
      const m = Number((await ex.fetchTicker(SYMBOL)).last);
      console.log(`\n  ── attempt ${side} ──`);
      await ex.createOrder(SYMBOL, "market", isLong ? "buy" : "sell", amount(SIZE), undefined, { clientOrderId: `bc${Date.now().toString(36)}` });
      await sleep(2500);
      const open = amount(Number((await livePosition(ex, SYMBOL))?.contracts ?? 0));
      if (!(open > 0)) { note("no position opened", "retrying"); continue; }

      // A FULL-SIZE reduce-only ladder, resting far away so it RESERVES without filling.
      const legs = [amount(open / 2), amount(open - amount(open / 2))];
      const batch = await ex.createOrders(
        legs.map((amt, i) => ({
          symbol: SYMBOL, type: "limit" as const, side: exitSide as "buy" | "sell", amount: amt,
          price: price(m * (isLong ? 1.06 + i * 0.01 : 0.94 - i * 0.01)),
          params: { reduceOnly: true, clientOrderId: `bl${i}${Date.now().toString(36)}` },
        })),
      ).catch((e) => { note("ladder rejected", String(e).slice(0, 150)); return [] as Order[]; });
      note("ladder legs resting", `${batch.filter((o) => o.id).length}/${legs.length} covering ${legs.reduce((a, b) => a + b, 0)}/${open}`);

      // The stop: SIZED to the whole position and explicitly reduce-only — ccxt will not add the
      // flag itself. This is the exact shape that starves on Bitget.
      const trig = price(m * (isLong ? 1 - TRIGGER_GAP : 1 + TRIGGER_GAP));
      const armed = await ex
        .createOrder(SYMBOL, "market", exitSide, open, undefined, { stopLossPrice: trig, reduceOnly: true })
        .then(() => true, (e) => { note("stop rejected", String(e).slice(0, 150)); return false; });
      if (!armed) continue;
      note("stop armed at", `${trig} (mark ${m})`);

      const deadline = Date.now() + ATTEMPT_MS;
      while (Date.now() < deadline) {
        await sleep(4000);
        const now = Number((await livePosition(ex, SYMBOL))?.contracts ?? 0);
        if (now === 0) { fired = true; verdict = "CLOSED"; break; }
        // The stop is gone but contracts remain ⇒ it fired and died without closing — the
        // starvation fingerprint.
        if ((await families(ex)).stops.length === 0) { fired = true; verdict = `STOP GONE but ${now} contracts REMAIN`; break; }
      }
      if (fired) break;
      note("not taken out in this window", "switching side");
    }

    if (!fired) {
      console.log("\n  ~ C INCONCLUSIVE — the market sat inside every trigger. Re-run.");
    } else {
      const left = Number((await livePosition(ex, SYMBOL))?.contracts ?? 0);
      answer("C", left === 0
        ? "NO STARVATION — the stop closed the WHOLE position despite a full reduce-only ladder. Usable for the ratchet."
        : `STARVED — the stop is gone but ${left} contracts remain (${verdict}). Like Bitget's normal_plan: the ratchet CANNOT use this shape.`);
      check("the position was fully closed by its own stop", left === 0, `contracts left=${left}`);
    }
  } finally {
    console.log("\n── cleanup ──");
    await flatten(ex);
    const final = await livePosition(ex, SYMBOL);
    const fam = await families(ex);
    check("flat", Number(final?.contracts ?? 0) === 0, `contracts=${final?.contracts ?? 0}`);
    check("no orders left", fam.all.length === 0, `orders=${fam.all.length}`);
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.message : e); process.exit(1); });
