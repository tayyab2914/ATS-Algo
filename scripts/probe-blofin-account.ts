// BloFin account-shape probe — the first thing to run, before any BloFin engine code exists.
// Modelled on probe-bybit-account.ts: READ-ONLY plus DRY-RUN, so it places no orders, cancels
// nothing, and changes no account setting. Mutating calls are captured at the HTTP boundary and
// discarded, so the request bodies below are the real ones the adapter would have sent.
//
// BloFin is the awkward one, and three things need settling before the adapter can be written:
//
//   1. SIZE IS A CONTRACT COUNT, not base units. `contractValue` for BTC-USDT is 0.001, so one
//      contract is 0.001 BTC and the venue's minSize of 0.1 is 0.0001 BTC. Bitget and Bybit both
//      have contractSize 1, which is why the engine has never needed a conversion. The question
//      this probe answers is whether ccxt normalises it for us or passes it straight through —
//      because if it passes through, every size the engine computes is out by 1000x.
//   2. `fetchOrder` DOES NOT EXIST on this adapter. `openPosition` uses it to read the true fill
//      (createOrder returns only an id), so a substitute has to be found.
//   3. `setLeverage` silently defaults to marginMode 'cross'. Called the way Bitget is called, it
//      would set the cross leverage while the account runs isolated.
//
//   NODE_OPTIONS="--conditions=react-server" npx tsx scripts/probe-blofin-account.ts
import "dotenv/config";
import ccxt, { type Exchange, type MarketInterface } from "ccxt";

const SYMBOL = "BTC/USDT:USDT";
const CHECKS = ["BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT"];
const LEVERAGE = 5;

const key = process.env.BLOFIN_DEMO_KEY?.trim();
const secret = process.env.BLOFIN_DEMO_SECRET?.trim();
const passphrase = process.env.BLOFIN_DEMO_PASSPHRASE?.trim();

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);
const answer = (label: string, value: string) => console.log(`  ★ ${label}: ${value}`);

class DryRun extends Error {}
type Wire = { method: string; url: string; body: unknown };

/** A client whose transport is severed, so a mutating call yields its request body only. */
function dryRunClient(markets: MarketInterface[]): { ex: Exchange; wire: Wire[] } {
  const ex = new ccxt.blofin({
    apiKey: "dry", secret: "dry", password: "dry",
    options: { defaultType: "swap" },
  });
  ex.setSandboxMode(true);
  ex.setMarkets(markets);
  const wire: Wire[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ex as any).fetch = async (url: string, method = "GET", _h?: unknown, body?: string) => {
    let parsed: unknown = body;
    try { parsed = body ? JSON.parse(body) : undefined; } catch { /* querystring */ }
    wire.push({ method, url: String(url).replace(/^https?:\/\/[^/]+/, ""), body: parsed });
    throw new DryRun("captured");
  };
  return { ex, wire };
}

async function capture(label: string, wire: Wire[], call: () => Promise<unknown>): Promise<Wire | null> {
  const before = wire.length;
  try {
    await call();
    console.log(`  ✗ ${label} — nothing reached the transport`);
    failures++;
    return null;
  } catch (error) {
    if (!(error instanceof DryRun)) {
      console.log(`  ! ${label} — rejected before sending: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    const c = wire[before];
    console.log(`  → ${label}\n      ${c.method} ${c.url}\n      ${JSON.stringify(c.body)}`);
    return c;
  }
}

async function main() {
  console.log(`ccxt ${ccxt.version}\n`);
  if (!key || !secret || !passphrase) throw new Error("BLOFIN_DEMO_KEY / SECRET / PASSPHRASE missing from .env");

  // ── 1. auth on the demo host ────────────────────────────────────────────────
  console.log("── demo auth ──");
  const ex = new ccxt.blofin({
    apiKey: key, secret, password: passphrase,
    enableRateLimit: true, timeout: 20_000,
    options: { defaultType: "swap" },
  });
  // BloFin's demo is a pure URL swap to demo-trading-openapi — no header, no separate flag,
  // unlike Bitget (header on the live host) and Bybit (enableDemoTrading, a third host).
  ex.setSandboxMode(true);
  note("rest host", (ex.urls.api as Record<string, string>).rest ?? ex.urls.api);
  check("on the demo host", JSON.stringify(ex.urls.api).includes("demo-trading"));
  note("requiredCredentials", JSON.stringify(ex.requiredCredentials));
  check("passphrase is required (unlike Bybit)", ex.requiredCredentials.password === true);

  const balance = await ex.fetchBalance();
  const totals = (balance.total ?? {}) as unknown as Record<string, number | undefined>;
  const usdt = Number(totals.USDT ?? 0);
  check("demo key authenticates", true, "fetchBalance returned");
  check("demo wallet is funded", usdt > 0, `USDT total=${usdt}`);
  if (usdt <= 0) console.log('      ↳ press "Adjust Funds" on the demo Futures asset page (USDT-M)');

  // ── 2. THE SIZING QUESTION ──────────────────────────────────────────────────
  console.log("\n── sizing: contracts vs base units ──");
  await ex.loadMarkets();
  const market = ex.market(SYMBOL);
  note("market.id", market.id);
  note("contractSize", market.contractSize);
  note("limits.amount.min", market.limits?.amount?.min);
  note("precision.amount", market.precision.amount);
  note("limits.cost.min", market.limits?.cost?.min ?? "none");
  const contractSize = Number(market.contractSize ?? 1);
  check("contractSize is NOT 1 — this venue is contract-denominated", contractSize !== 1, `contractSize=${contractSize}`);
  const minAmount = Number(market.limits?.amount?.min ?? 0);
  answer(
    "MINIMUM ORDER",
    `${minAmount} (ccxt amount units) × contractSize ${contractSize} = ${(minAmount * contractSize).toPrecision(4)} BTC — ` +
      `compare Bitget 0.0001 BTC and Bybit 0.001 BTC`,
  );
  for (const s of CHECKS) {
    const m = ex.markets[s] as MarketInterface | undefined;
    check(`demo lists ${s}`, Boolean(m?.swap), m ? `id=${m.id} contractSize=${m.contractSize}` : "absent");
  }
  const perps = Object.values(ex.markets as Record<string, MarketInterface>).filter(
    (m) => m.swap && m.linear && m.quote === "USDT" && m.active,
  );
  note("demo USDT linear perps", perps.length);

  // ── 3. capability gaps ──────────────────────────────────────────────────────
  console.log("\n── capabilities the engine depends on ──");
  for (const cap of ["fetchOrder", "fetchOpenOrders", "fetchClosedOrders", "createOrders", "fetchMyTrades", "fetchPositions", "fetchMarginMode", "setMarginMode", "setPositionMode", "setLeverage", "closePosition"]) {
    const has = ex.has[cap];
    console.log(`  ${has ? "✓" : "✗"} has.${cap} = ${String(has)}`);
  }
  check("fetchOrder is ABSENT — openPosition needs another way to read the fill", !ex.has["fetchOrder"]);
  check("fetchMarginMode is present — the check-don't-change policy can use it", ex.has["fetchMarginMode"] === true);
  note("createOrders max", JSON.stringify(ex.features?.swap?.linear?.createOrders ?? "?"));

  // Can we read the account's margin mode? That decides whether BloFin gets the same
  // check-don't-change treatment as Bybit, which needed a raw implicit call.
  const marginMode = await ex.fetchMarginMode(SYMBOL).then(
    (m) => JSON.stringify(m),
    (e) => `THREW ${String(e).slice(0, 110)}`,
  );
  answer("ACCOUNT MARGIN MODE (read)", marginMode);
  const positionMode = await (ex as Exchange & { fetchPositionMode?: (s?: string) => Promise<unknown> })
    .fetchPositionMode?.(SYMBOL)
    .then((m) => JSON.stringify(m), (e) => `THREW ${String(e).slice(0, 110)}`);
  answer("ACCOUNT POSITION MODE (read)", String(positionMode));

  // ── 4. what would go on the wire ────────────────────────────────────────────
  console.log("\n── dry-run: prep ──");
  const { ex: dry, wire } = dryRunClient([market]);
  await capture("setPositionMode(false) — one-way", wire, () => dry.setPositionMode(false, SYMBOL));
  console.log("      expect positionMode only, NO instId — account-global (BloFin's own UI:");
  console.log("      \"This setting applies to all contracts\")");
  await capture("setMarginMode('isolated')", wire, () => dry.setMarginMode("isolated", SYMBOL));
  console.log("      expect marginMode only, NO instId — the symbol is resolved then DISCARDED");
  await capture("setLeverage WITHOUT marginMode (the trap)", wire, () => dry.setLeverage(LEVERAGE, SYMBOL));
  console.log("      ⚠ expect marginMode:'cross' — the ccxt default. Sets the WRONG leverage.");
  await capture("setLeverage WITH marginMode isolated (correct)", wire, () =>
    dry.setLeverage(LEVERAGE, SYMBOL, { marginMode: "isolated" }));

  console.log("\n── dry-run: the order path ──");
  const size = Number(dry.amountToPrecision(SYMBOL, Math.max(minAmount, 1)));
  await capture("entry: market + attached stop", wire, () =>
    dry.createOrder(SYMBOL, "market", "buy", size, undefined, {
      marginMode: "isolated", clientOrderId: "probe-entry", stopLoss: { triggerPrice: 50_000 },
    }));
  await capture("TP ladder batch (reduceOnly)", wire, () =>
    dry.createOrders([
      { symbol: SYMBOL, type: "limit", side: "sell", amount: size, price: 130_000, params: { reduceOnly: true, marginMode: "isolated", clientOrderId: "probe-tp0" } },
      { symbol: SYMBOL, type: "limit", side: "sell", amount: size, price: 131_000, params: { reduceOnly: true, marginMode: "isolated", clientOrderId: "probe-tp1" } },
    ]));
  console.log("      ⚠ WATCH reduceOnly's TYPE: ccxt stringifies it in createOrder but may send a");
  console.log("      raw boolean in createOrders. BloFin's own payloads type it as a STRING.");
  await capture("movable stop via stopLossPrice", wire, () =>
    dry.createOrder(SYMBOL, "market", "sell", size, undefined, { stopLossPrice: 50_000, marginMode: "isolated", clientOrderId: "probe-stop" }));
  console.log("      expect trade/order-algo with reduceOnly forced — the STARVED shape, not");
  console.log("      the position-level one. The TPSL family is the pos_loss analogue.");
  await capture("enumerate: algo/trigger orders", wire, () => dry.fetchOpenOrders(SYMBOL, undefined, undefined, { trigger: true }));
  await capture("enumerate: TPSL orders", wire, () => dry.fetchOpenOrders(SYMBOL, undefined, undefined, { tpsl: true }));
  await capture("enumerate: plain orders", wire, () => dry.fetchOpenOrders(SYMBOL));
  await capture("closePosition (BloFin has a primitive Bitget/Bybit lack)", wire, () =>
    dry.closePosition(SYMBOL, undefined, { marginMode: "isolated" }));
  console.log("      note params.autoCxl — cancels resting close orders automatically, default false");

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.message : e); process.exit(1); });
