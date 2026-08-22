// BingX: what happens to a stop when the position under it goes away, and can a position be
// flipped directly? Real orders, VST demo engine, unified ccxt only.
//
// These are the questions probe-bingx-stops.ts could not answer, and both bear on the SWING
// reversal every bot here performs (a LONG signal on a short position closes it and opens the
// other way — dispatch.ts):
//
//   F. Does a stop SURVIVE its position being closed? If a stale sell-stop outlives a long and
//      the bot immediately reverses into a short, that stop is now sitting on the wrong side of
//      a live position at a dead trigger. Bitget's pos_loss does exactly this, which is why
//      `clearWorking` exists and why closeAll calls it by id.
//   G. Does an OVERSIZED opposite market order flip the position in one call? Bybit allows it —
//      and leaves the new position NAKED, which is why dispatch.ts must keep flatten-then-open
//      rather than "optimising" into a single order.
//
// ⚠ Places real orders on open-api-vst.bingx.com. Read-only with respect to account settings:
//   it sets nothing, and refuses to run unless the account is already one-way.
//
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/probe-bingx-reversal.ts
import "dotenv/config";
import ccxt, { type Exchange, type MarketInterface, type Order } from "ccxt";
import { exchangeClient, livePosition, type TradeCreds } from "../lib/execution/client";

const VENUE = "Bingx";
const SYMBOL = "BTC/USDT:USDT";
const SIZE = 0.004;

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
    return `${String(o.id).slice(0, 12)}|${i.type ?? o.type}|${o.side}|amt=${o.amount ?? "-"}|trig=${String(i.stopPrice ?? "-")}`;
  });

/** Deduped — plain and {trigger:true} return the SAME rows on this venue. */
async function resting(ex: Exchange): Promise<Order[]> {
  const plain = await ex.fetchOpenOrders(SYMBOL).catch(() => [] as Order[]);
  const trigger = await ex.fetchOpenOrders(SYMBOL, undefined, undefined, { trigger: true }).catch(() => [] as Order[]);
  const byId = new Map<string, Order>();
  for (const o of [...plain, ...trigger]) if (o.id) byId.set(o.id, o);
  return [...byId.values()];
}

const stopsOf = (orders: Order[]) =>
  orders.filter((o) => String(((o.info ?? {}) as Record<string, unknown>).type ?? "").includes("STOP"));

async function flatten(ex: Exchange) {
  for (const o of await resting(ex)) if (o.id) await ex.cancelOrder(o.id, SYMBOL).catch(() => {});
  const live = await livePosition(ex, SYMBOL);
  const contracts = Number(live?.contracts ?? 0);
  if (contracts > 0) {
    await ex.createOrder(SYMBOL, "market", live?.side === "long" ? "sell" : "buy", contracts, undefined, { reduceOnly: true }).catch(() => {});
  }
  await sleep(2000);
  for (const o of await resting(ex)) if (o.id) await ex.cancelOrder(o.id, SYMBOL).catch(() => {});
  await sleep(800);
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
  const hedged = await ex.fetchPositionMode(SYMBOL).then((m) => m.hedged, () => null);
  if (hedged !== false) throw new Error("ACCOUNT IS IN HEDGE MODE — switch to One-way, then re-run");
  console.log(`open-api-vst · ${SYMBOL} · one-way\n`);

  const price = (n: number) => Number(ex.priceToPrecision(SYMBOL, n));
  const amount = (n: number) => Number(ex.amountToPrecision(SYMBOL, n));

  try {
    // ══ F · does a stop outlive its position? ═══════════════════════════════
    console.log("══ F · does a stop SURVIVE the position being closed? ══");
    await flatten(ex);
    const mark = Number((await ex.fetchTicker(SYMBOL)).last);
    await ex.createOrder(SYMBOL, "market", "buy", amount(SIZE), undefined, {
      clientOrderId: `bf${Date.now().toString(36)}`,
      stopLoss: { triggerPrice: price(mark * 0.9) },
    });
    await sleep(2500);
    const held = amount(Number((await livePosition(ex, SYMBOL))?.contracts ?? 0));
    // A second stop too, so this covers BOTH the entry-attached backstop and a ratchet
    // generation — they could plausibly be reaped differently.
    await ex
      .createOrder(SYMBOL, "market", "sell", held, undefined, { stopLossPrice: price(mark * 0.95), reduceOnly: true })
      .then((o) => note("second stop", o.id), (e) => note("second stop rejected", String(e).slice(0, 120)));
    await sleep(2000);
    const beforeClose = stopsOf(await resting(ex));
    note("stops before the close", fmt(beforeClose).join("  ") || "(none)");
    check("two stops are resting before the close", beforeClose.length === 2, `count=${beforeClose.length}`);

    // Market-close WITHOUT cancelling anything — exactly what a naive flatten would do.
    await ex.createOrder(SYMBOL, "market", "sell", held, undefined, { reduceOnly: true });
    await sleep(3500);
    const posAfter = Number((await livePosition(ex, SYMBOL))?.contracts ?? 0);
    const afterClose = stopsOf(await resting(ex));
    note("position after the close", `${posAfter} contracts`);
    note("stops after the close", fmt(afterClose).join("  ") || "(none)");
    answer("F", afterClose.length === 0
      ? "REAPED — the venue cancels stops when the position closes, so no stray stop can bind to a reversal"
      : `⚠ ${afterClose.length} STOP(S) SURVIVED a closed position. A reversal into the opposite side would inherit them — clearWorking must cancel by id at flatten.`);

    // If they survived, does a stale stop actually attach to a NEW opposite position?
    if (afterClose.length > 0) {
      console.log("\n  ── does a stale stop bind to a freshly reversed position? ──");
      await ex.createOrder(SYMBOL, "market", "sell", amount(SIZE), undefined, { clientOrderId: `bg${Date.now().toString(36)}` });
      await sleep(3000);
      const shortPos = await livePosition(ex, SYMBOL);
      const stillResting = stopsOf(await resting(ex));
      note("new position", `${shortPos?.side} ${shortPos?.contracts}`);
      note("stale stops still resting", fmt(stillResting).join("  ") || "(none)");
      answer("F-bind", stillResting.length > 0
        ? "⚠ the stale SELL stops are still on the book against a SHORT position — on trigger they would ADD to it, not close it"
        : "the stale stops were dropped once the opposite position opened");
    }

    // ══ G · can a position be flipped in ONE order? ════════════════════════
    console.log("\n══ G · does an OVERSIZED opposite market order flip the position? ══");
    await flatten(ex);
    await ex.createOrder(SYMBOL, "market", "buy", amount(SIZE), undefined, { clientOrderId: `bh${Date.now().toString(36)}` });
    await sleep(2500);
    const longSize = amount(Number((await livePosition(ex, SYMBOL))?.contracts ?? 0));
    check("a long is open to flip", longSize > 0, `contracts=${longSize}`);
    const flip = await ex
      .createOrder(SYMBOL, "market", "sell", amount(longSize * 2), undefined, { clientOrderId: `bi${Date.now().toString(36)}` })
      .then(() => ({ ok: true as const }), (e) => ({ ok: false as const, msg: String(e).slice(0, 170) }));
    await sleep(3000);
    const flipped = await livePosition(ex, SYMBOL);
    note("position after an oversized opposite order", `${flipped?.side ?? "flat"} ${flipped?.contracts ?? 0}`);
    answer("G", !flip.ok
      ? `REJECTED — a direct flip is not possible: ${flip.msg}. flatten-then-open is the only route, which is what dispatch.ts already does.`
      : flipped?.side === "short"
        ? "ALLOWED — the venue flipped long→short in ONE order. Do NOT optimise dispatch.ts into a single-order reversal: a flip carries no attached stop, so the new position would be naked until a second call."
        : `the order was accepted but the position is ${flipped?.side ?? "flat"} ${flipped?.contracts ?? 0} — the excess did not open a reverse`);
  } finally {
    console.log("\n── cleanup ──");
    await flatten(ex);
    const final = await livePosition(ex, SYMBOL);
    const left = await resting(ex);
    check("flat", Number(final?.contracts ?? 0) === 0, `contracts=${final?.contracts ?? 0}`);
    check("no orders left", left.length === 0, `orders=${left.length}`);
  }

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.message : e); process.exit(1); });
