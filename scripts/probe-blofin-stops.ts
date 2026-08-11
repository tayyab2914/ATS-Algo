// The BloFin stop questions that decide whether its ratchet is safe. Real orders, demo engine,
// everything through ccxt's UNIFIED api — no raw implicit endpoints (Bybit needed one to clear a
// stop; BloFin does not).
//
//   A. Does the entry-attached SL live in the SAME slot as a TPSL stop, or its own?
//      Bitget: two independent slots, which is what makes its never-naked guarantee a VENUE
//      property. Bybit: one slot, so the guarantee becomes OUR code's job. BloFin unknown.
//   B. Is a SIZELESS TPSL accepted? (createTpslOrderRequest only sets `size` when amount is
//      given, so omitting it should mint a whole-position stop — Bybit's Full-mode analogue.)
//   C. THE ONE THAT MATTERS: does a TPSL stop STARVE behind a full reduce-only ladder?
//      Bitget's reduce-only plan stop does — proven, it filled 0.0001 of 0.0018 and died.
//      Bybit's cannot, because its stop is not an order and holds no reservation. BloFin's TPSL
//      IS an order and carries reduceOnly: true by default, so it could go either way. If it
//      starves, the ratchet cannot use it and the whole stop model needs rethinking.
//   D. Can it be moved in place and cancelled?
//
// ⚠ Places real orders on demo-trading-openapi.blofin.com and SETS the demo account to isolated
//   margin + one-way. That is test-fixture setup, not engine behaviour: the engine's policy for
//   this venue is check-don't-change. Refuses to run off the demo host. Cleans up in a finally.
//
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/probe-blofin-stops.ts
import "dotenv/config";
import type { Exchange, Order } from "ccxt";
import { exchangeClient, getMarket, livePosition, type TradeCreds } from "../lib/execution/client";

const VENUE = "Blofin";
const SYMBOL = "BTC/USDT:USDT";
const LEVERAGE = 5;
const MARGIN = "isolated";
/** In VENUE units (contracts). BTC-USDT contractSize is 0.001, so 30 ⇒ 0.03 BTC. */
const SIZE = 30;
const TRIGGER_GAP = 0.0002;
const ATTEMPT_MS = 80_000;
const SIDES: ("LONG" | "SHORT")[] = ["LONG", "SHORT", "LONG", "SHORT"];

const creds: TradeCreds = {
  apiKey: process.env.BLOFIN_DEMO_KEY ?? "",
  apiSecret: process.env.BLOFIN_DEMO_SECRET ?? "",
  passphrase: process.env.BLOFIN_DEMO_PASSPHRASE ?? "",
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
    return `${String(o.id).slice(0, 10)}|${o.side}|amt=${o.amount ?? "-"}|sl=${String(i.slTriggerPrice ?? i.triggerPrice ?? "-")}|ro=${JSON.stringify(i.reduceOnly)}`;
  });

/** The three families, each its own endpoint. No single call returns them all. */
async function families(ex: Exchange) {
  const plain = await ex.fetchOpenOrders(SYMBOL).catch(() => [] as Order[]);
  const algo = await ex.fetchOpenOrders(SYMBOL, undefined, undefined, { trigger: true }).catch(() => [] as Order[]);
  const tpsl = await ex.fetchOpenOrders(SYMBOL, undefined, undefined, { tpsl: true }).catch(() => [] as Order[]);
  return { plain, algo, tpsl };
}

async function flatten(ex: Exchange) {
  for (const p of [{ tpsl: true }, { trigger: true }, {}]) {
    const open = await ex.fetchOpenOrders(SYMBOL, undefined, undefined, p).catch(() => [] as Order[]);
    for (const o of open) if (o.id) await ex.cancelOrder(o.id, SYMBOL, p).catch(() => {});
  }
  const live = await livePosition(ex, SYMBOL);
  const contracts = Number(live?.contracts ?? 0);
  if (contracts > 0) {
    await ex
      .createOrder(SYMBOL, "market", live?.side === "long" ? "sell" : "buy", contracts, undefined, { marginMode: MARGIN, reduceOnly: true })
      .catch((e) => note("flatten failed", String(e).slice(0, 110)));
  }
  await sleep(1800);
}

async function main() {
  if (!creds.apiKey || !creds.apiSecret || !creds.passphrase) throw new Error("BLOFIN_DEMO_* missing from .env");
  const market = await getMarket(VENUE, SYMBOL, true);
  if (!market) throw new Error(`demo does not list ${SYMBOL}`);
  const ex = await exchangeClient(VENUE, creds, [market]);
  if (!JSON.stringify(ex.urls.api).includes("demo-trading")) throw new Error("REFUSING TO RUN: not the demo host");
  console.log(`demo-trading · ${SYMBOL} · contractSize ${market.contractSize}\n`);

  const price = (n: number) => Number(ex.priceToPrecision(SYMBOL, n));

  // ── fixture setup ─────────────────────────────────────────────────────────
  // SETTING isolated here is deliberate and is NOT what the engine does: BloFin's margin mode is
  // account-global, so the engine only ever CHECKS it. A test may configure its own fixture.
  console.log("── fixture: one-way + isolated + leverage ──");
  await ex.setPositionMode(false, SYMBOL).then(() => check("position mode net_mode", true), (e) => note("setPositionMode", String(e).slice(0, 90)));
  await ex.setMarginMode(MARGIN, SYMBOL).then(() => check("margin mode isolated", true), (e) => note("setMarginMode", String(e).slice(0, 90)));
  // marginMode is MANDATORY here — ccxt defaults it to 'cross' and would set the wrong leverage.
  await ex.setLeverage(LEVERAGE, SYMBOL, { marginMode: MARGIN }).then(() => check(`leverage ${LEVERAGE} (isolated)`, true), (e) => note("setLeverage", String(e).slice(0, 90)));
  const mode = await ex.fetchMarginMode(SYMBOL).then((m) => String(m.marginMode), () => "?");
  check("fetchMarginMode confirms isolated", mode === "isolated", mode);

  try {
    // ══ A · slots ═══════════════════════════════════════════════════════════
    console.log("\n══ A · is the entry-attached SL its own slot, or the TPSL slot? ══");
    await flatten(ex);
    const mark0 = Number((await ex.fetchTicker(SYMBOL)).last);
    const backstop = price(mark0 * 0.9);
    await ex.createOrder(SYMBOL, "market", "buy", SIZE, undefined, {
      marginMode: MARGIN, clientOrderId: `bf${Date.now().toString(36)}`,
      stopLoss: { triggerPrice: backstop },
    });
    await sleep(2500);
    let pos = await livePosition(ex, SYMBOL);
    note("position", `${pos?.contracts} contracts (${Number(pos?.contracts ?? 0) * Number(market.contractSize ?? 1)} BTC)`);
    let fam = await families(ex);
    note("plain", fmt(fam.plain).join("  ") || "(none)");
    note("algo  (trigger:true)", fmt(fam.algo).join("  ") || "(none)");
    note("tpsl  (tpsl:true)", fmt(fam.tpsl).join("  ") || "(none)");
    const attachedInTpsl = fam.tpsl.length > 0;
    answer("A", attachedInTpsl
      ? "the entry-attached SL SURFACES in the TPSL family — so a TPSL stop shares its slot (Bybit-like, ONE slot)"
      : "the entry-attached SL is NOT in the TPSL family — it may be its own slot (Bitget-like, TWO slots)");

    // ══ B · sizeless TPSL ═══════════════════════════════════════════════════
    console.log("\n══ B · is a SIZELESS TPSL accepted? ══");
    pos = await livePosition(ex, SYMBOL);
    const tight = price(Number(pos?.markPrice ?? mark0) * 0.97);
    const minted = await ex
      .createOrder(SYMBOL, "market", "sell", undefined as unknown as number, undefined, {
        tpsl: true, stopLossPrice: tight, marginMode: MARGIN,
      })
      .then((o) => ({ ok: true as const, o }), (e) => ({ ok: false as const, msg: String(e).slice(0, 160) }));
    if (!minted.ok) {
      answer("B", `REJECTED — a sizeless TPSL is not accepted: ${minted.msg}`);
      // So the stop MUST be sized. Which means it goes stale as rungs shrink the position —
      // Bitget's oversized-stop problem, in a venue that has only one slot to put it in.
      const held = Number((await livePosition(ex, SYMBOL))?.contracts ?? 0);
      const sized = await ex
        .createOrder(SYMBOL, "market", "sell", held, undefined, { tpsl: true, stopLossPrice: tight, marginMode: MARGIN })
        .then((o) => ({ ok: true as const, o }), (e) => ({ ok: false as const, msg: String(e).slice(0, 160) }));
      answer("B-sized", sized.ok
        ? `a SIZED TPSL (${held} contracts) IS accepted, id ${sized.ok ? sized.o.id : ""}`
        : `even a SIZED TPSL was rejected: ${sized.msg}`);
      await sleep(2000);
      note("tpsl family after the sized mint", fmt((await families(ex)).tpsl).join("  ") || "(none)");
    } else {
      note("mint id", minted.o.id ?? "(none)");
      await sleep(2000);
      fam = await families(ex);
      note("tpsl family now", fmt(fam.tpsl).join("  ") || "(none)");
      answer("B", `ACCEPTED — sizeless TPSL minted, id ${minted.o.id ?? "(none)"}; amount reported ${fam.tpsl[0]?.amount ?? "(none)"}`);
    }

    // ══ D · move in place, then cancel ══════════════════════════════════════
    console.log("\n══ D · move in place, then cancel ══");
    const before = (await families(ex)).tpsl;
    const tighter = price(Number((await livePosition(ex, SYMBOL))?.markPrice ?? mark0) * 0.98);
    const heldD = Number((await livePosition(ex, SYMBOL))?.contracts ?? 0);
    let secondOk = false;
    await ex
      .createOrder(SYMBOL, "market", "sell", heldD, undefined, { tpsl: true, stopLossPrice: tighter, marginMode: MARGIN })
      .then(() => { secondOk = true; note("second TPSL (sized)", "accepted"); }, (e) => note("second TPSL rejected", String(e).slice(0, 140)));
    await sleep(2000);
    const after = (await families(ex)).tpsl;
    note("tpsl family after a second mint", fmt(after).join("  ") || "(none)");
    answer("D-stack", !secondOk
      ? "UNANSWERED — the second mint was rejected, so nothing was replaced or stacked"
      : after.length <= 1
        ? "REPLACED in place — one slot, so the ratchet can overwrite (like Bybit)"
        : `STACKED — ${after.length} TPSL stops rest, so the ratchet MUST cancel-first (like Bitget)`);
    for (const o of after) {
      if (!o.id) continue;
      const done = await ex.cancelOrder(o.id, SYMBOL, { tpsl: true }).then(() => "ok", (e) => String(e).slice(0, 110));
      note(`cancelOrder(${String(o.id).slice(0, 10)}, {tpsl:true})`, done);
    }
    await sleep(2000);
    check("cancel via unified ccxt removed the TPSL stops", (await families(ex)).tpsl.length === 0);
    note("does the entry-attached SL survive the TPSL cancel?", (await families(ex)).tpsl.length === 0 ? "checked below" : "?");
    const posAfterCancel = await livePosition(ex, SYMBOL);
    note("position still open", `${posAfterCancel?.contracts ?? 0} contracts`);
    void before;

    // ══ C · STARVATION — the one that decides the model ═════════════════════
    console.log("\n══ C · does a TPSL stop STARVE behind a full reduce-only ladder? ══");
    let fired = false;
    let verdict = "";
    for (const side of SIDES) {
      await flatten(ex);
      const isLong = side === "LONG";
      const exitSide = isLong ? "sell" : "buy";
      const m = Number((await ex.fetchTicker(SYMBOL)).last);
      console.log(`\n  ── attempt ${side} ──`);
      await ex.createOrder(SYMBOL, "market", isLong ? "buy" : "sell", SIZE, undefined, { marginMode: MARGIN, clientOrderId: `bc${Date.now().toString(36)}` });
      await sleep(2500);
      const held = Number((await livePosition(ex, SYMBOL))?.contracts ?? 0);
      if (!(held > 0)) { note("no position opened", "retrying"); continue; }

      // A FULL-SIZE reduce-only ladder, resting far away so it reserves without filling.
      const legs = [Math.floor(held / 2), held - Math.floor(held / 2)];
      const batch = await ex.createOrders(
        legs.map((amount, i) => ({
          symbol: SYMBOL, type: "limit" as const, side: exitSide as "buy" | "sell", amount,
          price: price(m * (isLong ? 1.06 + i * 0.01 : 0.94 - i * 0.01)),
          params: { reduceOnly: true, marginMode: MARGIN, clientOrderId: `bl${i}${Date.now().toString(36)}` },
        })),
      ).catch((e) => { note("ladder rejected", String(e).slice(0, 140)); return [] as Order[]; });
      note("ladder legs resting", `${batch.filter((o) => o.id).length}/${legs.length} covering ${legs.reduce((a, b) => a + b, 0)}/${held}`);

      // The stop, a hair the wrong side of the mark so an ordinary tick takes it.
      const trig = price(m * (isLong ? 1 - TRIGGER_GAP : 1 + TRIGGER_GAP));
      // SIZED to the whole position — sizeless is rejected (152001), so this is the only shape
      // available, and it is exactly the shape that starves on Bitget.
      const armed = await ex
        .createOrder(SYMBOL, "market", exitSide, held, undefined, { tpsl: true, stopLossPrice: trig, marginMode: MARGIN })
        .then(() => true, (e) => { note("TPSL rejected", String(e).slice(0, 140)); return false; });
      if (!armed) continue;
      note("TPSL armed at", `${trig} (mark ${m})`);

      const deadline = Date.now() + ATTEMPT_MS;
      while (Date.now() < deadline) {
        await sleep(4000);
        const now = Number((await livePosition(ex, SYMBOL))?.contracts ?? 0);
        if (now === 0) { fired = true; verdict = "CLOSED"; break; }
        const stopsLeft = (await families(ex)).tpsl.length;
        if (stopsLeft === 0) { fired = true; verdict = `STOP GONE but ${now} contracts REMAIN`; break; }
      }
      if (fired) break;
      note("not taken out in this window", "switching side");
    }

    if (!fired) {
      console.log("\n  ~ C INCONCLUSIVE — the market sat inside every trigger. Re-run.");
    } else {
      const left = Number((await livePosition(ex, SYMBOL))?.contracts ?? 0);
      answer("C", left === 0
        ? "NO STARVATION — the TPSL closed the whole position despite a full reduce-only ladder. Usable for the ratchet."
        : `STARVED — the stop is gone but ${left} contracts remain (${verdict}). BloFin behaves like Bitget's normal_plan: the ratchet CANNOT use a reduce-only TPSL.`);
      check("the position was fully closed by its own stop", left === 0, `contracts left=${left}`);
    }
  } finally {
    console.log("\n── cleanup ──");
    await flatten(ex);
    const final = await livePosition(ex, SYMBOL);
    const fam = await families(ex);
    check("flat", Number(final?.contracts ?? 0) === 0, `contracts=${final?.contracts ?? 0}`);
    check("no orders left in any family", fam.plain.length + fam.algo.length + fam.tpsl.length === 0,
      `plain=${fam.plain.length} algo=${fam.algo.length} tpsl=${fam.tpsl.length}`);
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.message : e); process.exit(1); });
