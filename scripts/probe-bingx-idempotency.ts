// BingX: the three facts the engine's crash-safety rests on. Real orders, VST demo engine.
//
//   H. Does a DUPLICATE clientOrderID get REJECTED? This is the whole idempotency model: order
//      ids are derived deterministically from (signal, deployment, kind, rung) so that a retried
//      fan-out cannot double-place, and that only works if the VENUE refuses the repeat. Bitget
//      rejects with 40786, Bybit with 110072. If BingX silently ACCEPTS one, a retry opens a
//      second position with real money behind it.
//   I. Does our 32-hex-char clientOrderId survive the round trip? Bybit's `orderLinkId` caps at
//      36 chars, and a venue that silently TRUNCATES or drops the id breaks both the dedupe
//      above and stop-out attribution.
//   J. How does a PARTIAL batch failure surface? Bybit returns top-level success with rejected
//      legs inside (no throw), which is why openPosition inspects every leg rather than relying
//      on try/catch. Bitget throws. BingX is unknown — and "one rung silently missing" is a
//      position trading without part of its ladder.
//
// ⚠ Places real orders on open-api-vst.bingx.com. Cancels everything in a finally.
//
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/probe-bingx-idempotency.ts
import "dotenv/config";
import ccxt, { type Exchange, type MarketInterface, type Order } from "ccxt";
import { exchangeClient, livePosition, type TradeCreds } from "../lib/execution/client";
import { clientOrderId } from "../lib/execution/execute";

const VENUE = "Bingx";
const SYMBOL = "BTC/USDT:USDT";
const SIZE = 0.0004;

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

async function resting(ex: Exchange): Promise<Order[]> {
  return ex.fetchOpenOrders(SYMBOL).catch(() => [] as Order[]);
}

async function cleanup(ex: Exchange) {
  for (const o of await resting(ex)) if (o.id) await ex.cancelOrder(o.id, SYMBOL).catch(() => {});
  const live = await livePosition(ex, SYMBOL);
  const contracts = Number(live?.contracts ?? 0);
  if (contracts > 0) {
    await ex.createOrder(SYMBOL, "market", live?.side === "long" ? "sell" : "buy", contracts, undefined, { reduceOnly: true }).catch(() => {});
  }
  await sleep(1800);
  for (const o of await resting(ex)) if (o.id) await ex.cancelOrder(o.id, SYMBOL).catch(() => {});
}

async function loadMarket(): Promise<MarketInterface | undefined> {
  const pub = new ccxt.bingx({ enableRateLimit: true, timeout: 20_000, options: { defaultType: "swap" } });
  pub.setSandboxMode(true);
  pub.has["fetchCurrencies"] = false;
  await pub.loadMarkets();
  return pub.markets[SYMBOL] as MarketInterface | undefined;
}

async function main() {
  if (!creds.apiKey || !creds.apiSecret) throw new Error("BINGX_DEMO_KEY / BINGX_DEMO_SECRET missing from .env");
  const market = await loadMarket();
  if (!market) throw new Error(`VST does not list ${SYMBOL}`);
  const ex = await exchangeClient(VENUE, creds, [market]);
  if (!JSON.stringify(ex.urls.api).includes("open-api-vst")) throw new Error("REFUSING TO RUN: not the VST host");
  console.log(`open-api-vst · ${SYMBOL}\n`);

  const price = (n: number) => Number(ex.priceToPrecision(SYMBOL, n));
  const amount = (n: number) => Number(ex.amountToPrecision(SYMBOL, n));

  try {
    await cleanup(ex);
    const mark = Number((await ex.fetchTicker(SYMBOL)).last);
    // Resting LIMIT orders far from the mark: this probe is about ids and batches, so nothing
    // should fill while it runs.
    const far = price(mark * 1.15);
    const size = amount(Math.max(SIZE, Number(market.limits?.amount?.min ?? 0), 2.5 / far));

    // ══ I · does our real clientOrderId survive the round trip? ═════════════
    console.log("══ I · clientOrderId round trip (32 hex chars, as the engine mints them) ══");
    // Run-unique seed. The engine's ids are deliberately DETERMINISTIC, but BingX keeps a
    // cancelled order's client id BURNED — a second run of this probe with the same seed dies on
    // 101481 before it tests anything. That is the venue behaving exactly as the idempotency
    // model wants; it just makes a repeatable probe need a fresh seed each time.
    const run = `probe-${Date.now().toString(36)}`;
    const oid = clientOrderId(run, "probe-userbot-id", "TP", 0);
    note("id we send", `${oid} (${oid.length} chars)`);
    const placed = await ex.createOrder(SYMBOL, "limit", "sell", size, far, { reduceOnly: false, clientOrderId: oid });
    await sleep(2000);
    const found = (await resting(ex)).find((o) => o.id === placed.id);
    const raw = (found?.info ?? {}) as Record<string, unknown>;
    const echoed = found?.clientOrderId ?? (raw.clientOrderID as string | undefined) ?? (raw.clientOrderId as string | undefined);
    note("id echoed back", JSON.stringify(echoed));
    check("the client id round-trips intact (no truncation, no drop)", echoed === oid, `sent ${oid.length} got ${String(echoed ?? "").length}`);

    // Also via fetchOrder, which is the path `readFill` uses on the entry.
    const viaFetch = placed.id ? await ex.fetchOrder(placed.id, SYMBOL).catch(() => null) : null;
    const fetchRaw = (viaFetch?.info ?? {}) as Record<string, unknown>;
    const fetchEchoed = viaFetch?.clientOrderId ?? (fetchRaw.clientOrderID as string | undefined);
    check("fetchOrder also returns the client id (readFill / attribution path)", fetchEchoed === oid, JSON.stringify(fetchEchoed));

    // ══ H · is a DUPLICATE client id rejected? ══════════════════════════════
    console.log("\n══ H · duplicate clientOrderID — rejected, or silently double-placed? ══");
    const dup = await ex
      .createOrder(SYMBOL, "limit", "sell", size, far, { reduceOnly: false, clientOrderId: oid })
      .then((o) => ({ ok: true as const, o }), (e) => ({ ok: false as const, msg: String(e).slice(0, 200) }));
    await sleep(2000);
    const sameId = (await resting(ex)).filter((o) => {
      const i = (o.info ?? {}) as Record<string, unknown>;
      return (o.clientOrderId ?? i.clientOrderID) === oid;
    });
    note("orders now carrying that client id", sameId.length);
    if (dup.ok) {
      answer("H", `⛔ ACCEPTED — the venue took a DUPLICATE client id (${sameId.length} orders now carry it, ids ${sameId.map((o) => String(o.id).slice(0, 12)).join(", ")}). Venue-side dedupe CANNOT be relied on; a retried fan-out would double-place unless the engine dedupes first.`);
    } else {
      answer("H", `REJECTED — ${dup.msg}`);
    }
    check("exactly one order carries the deterministic client id", sameId.length === 1, `count=${sameId.length}`);

    // ══ J · how does a PARTIAL batch failure surface? ═══════════════════════
    console.log("\n══ J · a batch with one deliberately bad leg ══");
    // The bad leg REUSES the client id still resting from test H. That is a guaranteed
    // SERVER-side rejection (101481, just proven) rather than something ccxt would catch
    // locally — a first attempt used a min-size leg, which turned out to be perfectly valid at
    // this price and proved nothing.
    const good = (i: number) => ({
      symbol: SYMBOL, type: "limit" as const, side: "sell" as const, amount: size, price: price(far * (1 + i * 0.01)),
      params: { clientOrderId: clientOrderId(`${run}-batch`, "probe-userbot-id", "TP", i) },
    });
    const badLeg = {
      symbol: SYMBOL, type: "limit" as const, side: "sell" as const, amount: size, price: price(far * 1.05),
      params: { clientOrderId: oid }, // already live on the book ⇒ 101481
    };
    const mixed = await ex
      .createOrders([good(0), badLeg, good(1)])
      .then((orders) => ({ threw: false as const, orders }), (e) => ({ threw: true as const, msg: String(e).slice(0, 220) }));
    if (mixed.threw) {
      // A throw is NOT the end of the question. The error payload came back carrying order ids,
      // which would mean the venue PLACED the good legs and then reported failure — and that is
      // strictly worse than either of the other two shapes: openPosition's catch would record
      // every rung as REJECTED in the database while real orders rest on the venue, unreconciled.
      await sleep(2500);
      const survivors = await resting(ex);
      const fromBatch = survivors.filter((o) => {
        const i = (o.info ?? {}) as Record<string, unknown>;
        const cid = String(o.clientOrderId ?? i.clientOrderID ?? "");
        return cid !== oid && cid !== "";
      });
      note("orders resting AFTER the throw", `${survivors.length} total, ${fromBatch.length} not from test H`);
      answer("J", fromBatch.length === 0
        ? `THREW and placed NOTHING — the batch is atomic. A try/catch around createOrders is sufficient: ${mixed.msg.slice(0, 90)}`
        : `⛔ THREW BUT PLACED ${fromBatch.length} LEG(S) — the batch is NOT atomic. openPosition must re-read the book after a batch failure, or those rungs are orphans the database believes were rejected.`);
      check("a failed batch left nothing resting (atomic)", fromBatch.length === 0, `orphans=${fromBatch.length}`);
    } else {
      const legs = mixed.orders.map((o) => `${o.id ?? "(no id)"}:${o.status ?? "-"}`);
      note("legs returned", legs.join("  "));
      const rejected = mixed.orders.filter((o) => !o.id || o.status === "rejected");
      answer("J", rejected.length > 0
        ? `NO THROW — ${rejected.length}/${mixed.orders.length} legs came back rejected inside a "successful" batch. openPosition's per-leg inspection is REQUIRED here, exactly as on Bybit.`
        : "no throw and no rejected leg — the bad leg was accepted after all, so this test needs a different failure to be conclusive");
    }

    // ══ the ladder shape the engine will actually send ══════════════════════
    console.log("\n══ K · a 6-rung ladder chunked to the venue's cap of 5 ══");
    for (const o of await resting(ex)) if (o.id) await ex.cancelOrder(o.id, SYMBOL).catch(() => {});
    await sleep(1500);
    const six = Array.from({ length: 6 }, (_, i) => ({
      symbol: SYMBOL, type: "limit" as const, side: "sell" as const, amount: size, price: price(far * (1 + i * 0.01)),
      params: { clientOrderId: clientOrderId(`${run}-six`, "probe-userbot-id", "TP", i) },
    }));
    const oneShot = await ex.createOrders(six).then(() => "ACCEPTED", (e) => String(e).slice(0, 120));
    note("6 legs in ONE call", oneShot);
    check("a 6-leg call is refused (so chunking is mandatory, not optional)", oneShot !== "ACCEPTED", String(oneShot));

    const chunked: Order[] = [];
    for (let from = 0; from < six.length; from += 5) chunked.push(...(await ex.createOrders(six.slice(from, from + 5))));
    await sleep(2500);
    const live = await resting(ex);
    note("chunked result", `${chunked.filter((o) => o.id).length} ids returned, ${live.length} resting`);
    check("all 6 rungs rest after chunking 5+1", live.length === 6, `resting=${live.length}`);
  } finally {
    console.log("\n── cleanup ──");
    await cleanup(ex);
    const left = await resting(ex);
    const pos = await livePosition(ex, SYMBOL);
    check("flat", Number(pos?.contracts ?? 0) === 0, `contracts=${pos?.contracts ?? 0}`);
    check("no orders left", left.length === 0, `orders=${left.length}`);
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.message : e); process.exit(1); });
