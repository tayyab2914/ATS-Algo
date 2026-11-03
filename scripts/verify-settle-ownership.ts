// The settle cleanup, proved against the interleaving that stripped a live stop — no key, no exchange.
//
// 2026-11-02 11:20, neilk's Bybit BTC deployment. A SHORT signal reversed the open LONG while the
// 11:20:00 reconcile pass was still running. That pass had loaded the LONG as OPEN, read the account
// flat in the second between the reversal's close and its re-entry, and settled it again. Its
// stop-out cleanup was symbol-wide — `cancelAllOrders` plus `clearWorking`, i.e. Bybit's
// `trading-stop stopLoss=0` — and it landed after the new SHORT's entry had attached its stop. The
// ladder went out a moment later and survived; the stop did not. The position ran naked from
// 11:20:10 until a ratchet re-armed it at 15:58:14.
//
// Each venue below is a fake that follows the listing and sweep rules ./stops records for it. The
// legacy sweep is replayed first, to prove the fake reproduces the damage, then the ownership
// cleanup on the same book must leave the next position whole — and must still clean up after a
// position that is genuinely gone.
//
// Run: NODE_OPTIONS="--conditions=react-server" npx tsx scripts/verify-settle-ownership.ts
import type { Exchange } from "ccxt";
import { cancelOwnLadder } from "../lib/execution/manage.ts";
import { stopStrategyFor } from "../lib/execution/stops.ts";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};

const SYMBOL = "BTC/USDT:USDT";
type Venue = "Bybit" | "Bitget" | "Blofin" | "Bingx";
type Row = { id: string; clientOrderId?: string; kind: "limit" | "stop"; at: number; info: Record<string, unknown> };

/** A venue's resting book, listed the way that venue lists it (see ./stops for each rule). */
function fakeVenue(venue: Venue, rows: Row[], opts: { readFails?: boolean } = {}) {
  const book = rows.map((r) => ({ ...r }));
  const calls: string[] = [];
  const listed = (params: Record<string, unknown>): Row[] => {
    switch (venue) {
      // The Full-mode stop is a real row in the PLAIN list as well as under {trigger:true}.
      case "Bybit": return params.trigger ? book.filter((r) => r.kind === "stop") : [...book];
      case "Blofin": return params.tpsl ? book.filter((r) => r.kind === "stop") : book.filter((r) => r.kind === "limit");
      // One family: `trigger` rides along in the query string and filters nothing.
      case "Bingx": return [...book];
      case "Bitget": return params.planType === "profit_loss" ? book.filter((r) => r.kind === "stop") : params.trigger ? [] : book.filter((r) => r.kind === "limit");
    }
  };
  const drop = (row: Row) => book.splice(book.indexOf(row), 1);
  const ex = {
    id: venue.toLowerCase(),
    markets: { [SYMBOL]: { id: "BTCUSDT" } },
    async fetchOpenOrders(_symbol: string, _since?: number, _limit?: number, params: Record<string, unknown> = {}) {
      if (opts.readFails) throw new Error("NetworkError");
      return listed(params).map((r) => ({ id: r.id, clientOrderId: r.clientOrderId, timestamp: r.at, info: r.info }));
    },
    async cancelOrder(id: string) {
      calls.push(`cancel ${id}`);
      const row = book.find((r) => r.id === id);
      if (!row) throw new Error("order not exists");
      // Bitget's entry preset cannot be cancelled through the unified API (execute.ts).
      if (row.info.planType === "loss_plan") throw new Error("40768 plan order cannot be canceled");
      drop(row);
    },
    async cancelAllOrders(_symbol: string, params: Record<string, unknown> = {}) {
      calls.push(`cancelAll ${JSON.stringify(params)}`);
      // Bybit's bare sweep takes the Full stop with it (proven, ./stops); elsewhere it takes limits.
      for (const row of listed(params)) if (venue === "Bybit" || row.kind === "limit") drop(row);
    },
    async privatePostV5PositionTradingStop(p: { stopLoss: string }) {
      calls.push(`tradingStop stopLoss=${p.stopLoss}`);
      // Symbol-wide: whatever occupies the one slot is cleared, whoever placed it.
      if (p.stopLoss === "0") for (const row of book.filter((r) => r.kind === "stop")) drop(row);
    },
  };
  return { ex: ex as unknown as Exchange, book, calls, has: (id: string) => book.some((r) => r.id === id) };
}

/**
 * A stop row as each venue's finder expects to read it. On Bitget an ENTRY stop is the
 * uncancellable `loss_plan` preset and a later one a ratchet `pos_loss` — two different things.
 */
function stopRow(venue: Venue, id: string, trigger: number, at: number, entry = false): Row {
  const info: Record<string, unknown> =
    venue === "Bybit" ? { stopOrderType: "StopLoss", triggerPrice: String(trigger) }
    : venue === "Bitget" ? { planType: entry ? "loss_plan" : "pos_loss", triggerPrice: String(trigger) }
    : venue === "Blofin" ? { slTriggerPrice: String(trigger) }
    : { type: "STOP_MARKET", stopPrice: String(trigger) };
  return { id, kind: "stop", at, info };
}
const limitRow = (id: string, clientOrderId: string, at: number): Row => ({ id, clientOrderId, kind: "limit", at, info: {} });

/** The flattened LONG as the stale reconcile pass loaded it: three rungs filled, three resting at load time. */
const OLD = {
  symbol: SYMBOL,
  orders: [
    ...[0, 1, 2].map((i) => ({ kind: "TP", state: "FILLED", exchangeOrderId: `old-tp-${i}`, clientOrderId: `old-oid-${i}` })),
    ...[3, 4, 5].map((i) => ({ kind: "TP", state: "OPEN", exchangeOrderId: `old-tp-${i}`, clientOrderId: `old-oid-${i}` })),
    { kind: "STOP", state: "OPEN", exchangeOrderId: "old-stop", clientOrderId: "old-oid-stop" },
  ],
};
const OLD_STOPS = new Set(["old-stop"]);

/** The SHORT the reversal had just opened: its entry stop, and (worst case) its ladder already out. */
const nextPosition = (venue: Venue): Row[] => [
  stopRow(venue, "new-stop", 80953.7, 2_000, true),
  ...[0, 1, 2, 3, 4, 5].map((i) => limitRow(`new-tp-${i}`, `new-oid-${i}`, 2_001 + i)),
];

async function legacySettle(venue: Venue, ex: Exchange) {
  for (const params of [{}, { trigger: true }]) await ex.cancelAllOrders(SYMBOL, params).catch(() => {});
  await stopStrategyFor(venue).clearWorking(ex, SYMBOL).catch(() => {});
}
async function ownershipSettle(venue: Venue, ex: Exchange) {
  await cancelOwnLadder(ex, OLD);
  await stopStrategyFor(venue).clearOwned(ex, SYMBOL, OLD_STOPS).catch(() => {});
}

async function main() {
  for (const venue of ["Bybit", "Bitget", "Blofin", "Bingx"] as const) {
    console.log(`\n── ${venue}: a stale settle lands after the reversal re-entered ──`);
    const legacy = fakeVenue(venue, nextPosition(venue));
    await legacySettle(venue, legacy.ex);
    const lostLadder = [0, 1, 2, 3, 4, 5].filter((i) => !legacy.has(`new-tp-${i}`)).length;
    console.log(`  · legacy sweep: next stop ${legacy.has("new-stop") ? "kept" : "STRIPPED"}, ${lostLadder}/6 of its rungs cancelled`);
    if (venue === "Bybit") check("the fake reproduces the incident: the legacy sweep strips the next position's stop", !legacy.has("new-stop"));

    const fixed = fakeVenue(venue, nextPosition(venue));
    await ownershipSettle(venue, fixed.ex);
    check("the next position keeps its stop", fixed.has("new-stop"));
    check("and all six of its rungs", [0, 1, 2, 3, 4, 5].every((i) => fixed.has(`new-tp-${i}`)));
    check("nothing symbol-wide was sent", fixed.calls.every((c) => !c.startsWith("cancelAll") && !c.startsWith("tradingStop")), fixed.calls.join(", "));
  }

  // Age is not ownership. While one position is live the oldest stop is its backstop, but after a
  // re-entry the oldest can be OURS, lingering, and the newest the next position's backstop — which
  // the age-split `findWorking` hands straight to a cancel.
  for (const venue of ["Blofin", "Bingx"] as const) {
    console.log(`\n── ${venue}: our backstop outlived the position, and the next one re-entered ──`);
    const rows = () => [stopRow(venue, "old-stop", 84341.3, 1_000), ...nextPosition(venue)];
    const legacy = fakeVenue(venue, rows());
    await legacySettle(venue, legacy.ex);
    console.log(`  · legacy sweep: next stop ${legacy.has("new-stop") ? "kept" : "STRIPPED"}, our stale stop ${legacy.has("old-stop") ? "left behind" : "cleared"}`);
    const fixed = fakeVenue(venue, rows());
    await ownershipSettle(venue, fixed.ex);
    check("the next position keeps its stop", fixed.has("new-stop"));
    check("our stale stop is cleared, so it cannot bind the next trade", !fixed.has("old-stop"));
  }

  console.log("\n── the cleanup still cleans up after a position that is really gone ──");
  for (const venue of ["Bybit", "Bitget", "Blofin", "Bingx"] as const) {
    const v = fakeVenue(venue, [
      stopRow(venue, "old-stop", 77346.8, 1_000),
      ...[3, 4, 5].map((i) => limitRow(`old-tp-${i}`, `old-oid-${i}`, 1_001 + i)),
      limitRow("manual-1", "member-typed-this", 1_010),
    ]);
    await ownershipSettle(venue, v.ex);
    check(`${venue}: our resting rungs are cancelled`, [3, 4, 5].every((i) => !v.has(`old-tp-${i}`)));
    check(`${venue}: our own stop is cleared`, !v.has("old-stop"));
    check(`${venue}: an order we did not place is left alone`, v.has("manual-1"));
  }

  console.log("\n── a rung whose id never came back is still ours by its client id ──");
  {
    const lost = { symbol: SYMBOL, orders: [{ kind: "TP", state: "REJECTED", exchangeOrderId: null, clientOrderId: "old-oid-5" }] };
    const v = fakeVenue("Bingx", [limitRow("x-9", "old-oid-5", 1_000), limitRow("new-tp-0", "new-oid-0", 2_000)]);
    await cancelOwnLadder(v.ex, lost);
    check("the orphaned rung is matched by client id and cancelled", !v.has("x-9"));
    check("a different position's rung is not", v.has("new-tp-0"));
  }

  console.log("\n── a failed read still cancels the rungs whose ids we recorded ──");
  {
    const v = fakeVenue("Bybit", [...[3, 4, 5].map((i) => limitRow(`old-tp-${i}`, `old-oid-${i}`, 1_000 + i))], { readFails: true });
    await cancelOwnLadder(v.ex, OLD);
    check("recorded ids are cancelled blind", [3, 4, 5].every((i) => !v.has(`old-tp-${i}`)), v.calls.join(", "));
    check("filled rungs are not re-cancelled", v.calls.every((c) => !/old-tp-[012]$/.test(c)));
  }
  }

main().then(() => {
  console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
});
