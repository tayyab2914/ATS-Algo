// Bybit account-shape probe — the FIRST thing to run, before any engine code exists.
//
// READ-ONLY AND DRY-RUN. It places no orders, cancels nothing, and changes no account
// setting. Every mutating call is captured at the HTTP boundary and thrown away, so the
// request bodies below are the real ones the adapter would have sent, built against real
// market descriptors — not written from memory.
//
// Answers, in order: does demo trading authenticate at all; what does ccxt believe about
// the account (and where does that belief come from); does the demo venue really list what
// the web UI shows; and what exactly would each prep + order call put on the wire.
//
//   BYBIT_DEMO_KEY="..." BYBIT_DEMO_SECRET="..." npx tsx scripts/probe-bybit-account.ts
//
// No passphrase: ccxt's bybit adapter has no `requiredCredentials` override, so it
// inherits `password: false`. Passing one is silently ignored.
import "dotenv/config";
import ccxt, { type Exchange, type MarketInterface } from "ccxt";

const SYMBOL = "BTC/USDT:USDT";
const SPOT_CHECKS = ["BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT"];
const LEVERAGE = 5;
const SIZE = 0.01;

const key = process.env.BYBIT_DEMO_KEY?.trim();
const secret = process.env.BYBIT_DEMO_SECRET?.trim();

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);

/** Thrown by the stubbed transport so a mutating call is captured, never sent. */
class DryRun extends Error {}

type Wire = { method: string; url: string; body: unknown };

/**
 * A client whose transport is severed. `enableDemoTrading` is set so `isUnifiedEnabled()`
 * short-circuits without a round-trip (bybit.js:1442) — otherwise the first capture would
 * be that probe rather than the call we asked about.
 */
function dryRunClient(markets: MarketInterface[]): { ex: Exchange; wire: Wire[] } {
  const ex = new ccxt.bybit({
    apiKey: "dry-run", secret: "dry-run",
    options: { defaultType: "swap", defaultSubType: "linear" },
  });
  ex.enableDemoTrading(true);
  ex.setMarkets(markets);

  const wire: Wire[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ex as any).fetch = async (url: string, method = "GET", _headers?: unknown, body?: string) => {
    let parsed: unknown = body;
    try { parsed = body ? JSON.parse(body) : undefined; } catch { /* querystring, keep raw */ }
    wire.push({ method, url: String(url).replace(/^https?:\/\/[^/]+/, ""), body: parsed });
    throw new DryRun("captured");
  };
  return { ex, wire };
}

/** Run a mutating call for its request body alone. Anything but DryRun is a real failure. */
async function capture(label: string, wire: Wire[], call: () => Promise<unknown>): Promise<Wire | null> {
  const before = wire.length;
  try {
    await call();
    console.log(`  ✗ ${label} — did NOT hit the transport (nothing captured)`);
    failures++;
    return null;
  } catch (error) {
    if (!(error instanceof DryRun)) {
      // A throw BEFORE the transport is itself a finding: ccxt refused to build the
      // request at all (a missing param, an unsupported combination, a precision guard).
      console.log(`  ! ${label} — rejected before sending: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    const captured = wire[before];
    console.log(`  → ${label}`);
    console.log(`      ${captured.method} ${captured.url}`);
    if (captured.body !== undefined) console.log(`      ${JSON.stringify(captured.body)}`);
    return captured;
  }
}

async function main() {
  console.log(`ccxt ${ccxt.version}\n`);
  if (!key || !secret) throw new Error("BYBIT_DEMO_KEY / BYBIT_DEMO_SECRET missing from .env");

  // ── 1. Does the demo host authenticate? ──────────────────────────────────────
  console.log("── demo trading auth ──");
  const ex = new ccxt.bybit({
    apiKey: key, secret,
    enableRateLimit: true, timeout: 15_000,
    options: { defaultType: "swap", defaultSubType: "linear" },
  });
  // Bybit switches HOST for demo (api-demo), unlike Bitget which sets a header on the
  // live host. setSandboxMode would send us to TESTNET — a different exchange entirely,
  // with its own registration and its own key — so it must NOT be used here.
  ex.enableDemoTrading(true);
  ex.has["fetchCurrencies"] = false; // private on bybit; the engine disables it too
  note("api host", (ex.urls.api as Record<string, string>).private ?? ex.urls.api);
  check("host is the demo engine, not testnet", JSON.stringify(ex.urls.api).includes("api-demo"));

  const balance = await ex.fetchBalance();
  // Read the USDT COIN balance, not account equity. On a UTA account the UI headline is a
  // USD-equivalent across coins — the $100K demo grant is ~50k USDT + ~50k USDC, so equity
  // reads roughly double the USDT actually available to a USDT-margined order.
  const totals = (balance.total ?? {}) as unknown as Record<string, number | undefined>;
  const usdt = Number(totals.USDT ?? 0);
  check("demo key authenticates", true, "fetchBalance returned");
  check("demo wallet is funded", usdt > 0, `USDT total=${usdt}`);
  if (usdt <= 0) {
    console.log("      ↳ click \"Start Trading with $100K Demo Assets\", or use Adjust Demo Funds");
  }
  check("enough headroom for a 6-rung ladder", usdt >= 200, `need ~200+ USDT, have ${usdt}`);

  // ── 2. What does ccxt BELIEVE about this account, and why? ───────────────────
  console.log("\n── account shape (and the demo divergence) ──");
  const [unifiedMargin, unifiedAccount] = await ex.isUnifiedEnabled();
  note("enableUnifiedMargin", unifiedMargin);
  note("enableUnifiedAccount", unifiedAccount);
  note("unifiedMarginStatus", ex.options["unifiedMarginStatus"]);
  console.log(
    "  ! In demo mode isUnifiedEnabled() NEVER asks the venue — bybit.js:1442-1448 hardcodes\n" +
    "    (false, true) and unifiedMarginStatus = 6 (UTA 2.0 Pro) because /v5/account/info is\n" +
    "    unavailable in demo. So these three numbers describe ccxt's ASSUMPTION, not your\n" +
    "    account. A demo pass therefore cannot prove any live code path that branches on\n" +
    "    unifiedMarginStatus. The one that does: createOrders REJECTS inverse contracts when\n" +
    "    status < 5 (bybit.js:3651) — harmless for us, we trade linear only.",
  );
  check("UTA path is the one under test (matches the web UI audit)", unifiedAccount === true);

  // ── 3. Does the demo venue list what the web UI claimed? ─────────────────────
  console.log("\n── demo instruments (the API's answer, not the web UI's) ──");
  await ex.loadMarkets();
  const isLinearPerp = (m: MarketInterface) => Boolean(m.swap && m.linear && m.quote === "USDT" && m.active);
  const demoPerps = Object.values(ex.markets as Record<string, MarketInterface>).filter(isLinearPerp);
  note("demo USDT linear perps", demoPerps.length);
  for (const symbol of SPOT_CHECKS) {
    const market = ex.markets[symbol] as MarketInterface | undefined;
    check(`demo lists ${symbol}`, Boolean(market && isLinearPerp(market)), market ? `id=${market.id}` : "absent");
  }

  const pub = new ccxt.bybit({ enableRateLimit: true, timeout: 15_000, options: { defaultType: "swap", defaultSubType: "linear" } });
  pub.has["fetchCurrencies"] = false;
  await pub.loadMarkets();
  const livePerps = Object.values(pub.markets as Record<string, MarketInterface>).filter(isLinearPerp);
  note("live USDT linear perps", livePerps.length);
  const missingInDemo = livePerps.filter((m) => !ex.markets[m.symbol]).map((m) => m.symbol);
  note("listed live but NOT in demo", missingInDemo.length);
  if (missingInDemo.length > 0) console.log(`      ${missingInDemo.slice(0, 12).join(", ")}${missingInDemo.length > 12 ? " …" : ""}`);
  // Bitget's paper venue lists ~51 of ~1950, which is the ONLY reason DEMO_FALLBACK_SYMBOL
  // exists. If Bybit's demo is complete, that substitution is dead code for this venue —
  // and a bot's real instrument can be exercised on paper instead of a stand-in.
  check(
    "demo is NOT a thin subset (so no demo-fallback substitution needed)",
    missingInDemo.length === 0,
    missingInDemo.length === 0 ? "complete" : `${missingInDemo.length} absent — fallback still required`,
  );

  const market = ex.market(SYMBOL);
  note("contractSize", market.contractSize);
  note("amount precision / min", `${market.precision.amount} / ${market.limits?.amount?.min}`);
  note("price precision", market.precision.price);
  note("min cost", market.limits?.cost?.min ?? "none");
  note("createOrders max batch", JSON.stringify(ex.features?.swap?.linear?.createOrders ?? ex.has["createOrders"]));

  // ── 4. Exactly what would go on the wire ─────────────────────────────────────
  console.log("\n── dry-run: prep sequence ──");
  const { ex: dry, wire } = dryRunClient([market]);

  await capture("setPositionMode(false, symbol) — one-way", wire, () => dry.setPositionMode(false, SYMBOL));
  console.log("      expect a `symbol` + `category`; per-symbol on Bybit (Bitget flips the whole productType)");

  await capture("setMarginMode('isolated', symbol)", wire, () => dry.setMarginMode("isolated", SYMBOL));
  console.log("      WATCH: on UTA the symbol is IGNORED and this is ACCOUNT-WIDE.");
  console.log("      Your account currently reads \"Cross Margin\", and Bybit gates the switch on:");
  console.log("      no Options positions, no active Spot Margin orders + Margin Trading off,");
  console.log("      sufficient assets, no outstanding liabilities. Any of those can fail it.");

  await capture("setLeverage(lev, symbol)", wire, () => dry.setLeverage(LEVERAGE, SYMBOL));
  console.log("      expect buyLeverage AND sellLeverage; a NO-OP repeat returns 110043 →");
  console.log("      ccxt BadRequest, NOT NoChange, so an idempotent prep pass will throw");

  console.log("\n── dry-run: the order path ──");
  await capture("entry: market + attached stop", wire, () =>
    dry.createOrder(SYMBOL, "market", "buy", SIZE, undefined, {
      clientOrderId: "probe-entry-1",
      stopLoss: { triggerPrice: Number(dry.priceToPrecision(SYMBOL, Number(market.precision.price) > 0 ? 50_000 : 50_000)) },
    }),
  );
  console.log("      a bare `stopLoss` field ⇒ tpslMode defaults to Full ⇒ SIZELESS position");
  console.log("      attribute, not an order: no id of its own, and CANCELLABLE (Bitget's is not)");

  await capture("TP ladder: batch of reduce-only limits", wire, () =>
    dry.createOrders([
      { symbol: SYMBOL, type: "limit", side: "sell", amount: 0.004, price: 130_000, params: { reduceOnly: true, clientOrderId: "probe-tp-0" } },
      { symbol: SYMBOL, type: "limit", side: "sell", amount: 0.003, price: 131_000, params: { reduceOnly: true, clientOrderId: "probe-tp-1" } },
    ]),
  );
  console.log("      cap is 10 per call (Bitget 50) — a longer ladder must be chunked.");
  console.log("      Partial failures DO NOT THROW: top-level retCode stays 0 and bad legs come");
  console.log("      back as status 'rejected' with id undefined. Every leg must be inspected.");

  await capture("movable stop, DEFAULT path (stopLossPrice)", wire, () =>
    dry.createOrder(SYMBOL, "market", "sell", SIZE, undefined, { stopLossPrice: 50_000, clientOrderId: "probe-stop-1" }),
  );
  console.log("      ⚠ reduceOnly is FORCED true ⇒ this is the STARVED shape (Bitget's normal_plan");
  console.log("      equivalent). NOT the pos_loss analogue. Do not use it for the ratchet.");

  await capture("movable stop, trading-stop path (the pos_loss analogue)", wire, () =>
    dry.createOrder(SYMBOL, "market", "sell", 0, undefined, {
      stopLossPrice: 50_000, clientOrderId: "probe-stop-2",
      tradingStopEndpoint: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  );
  console.log("      amount 0 ⇒ tpslMode Full (sizeless). NOTE the clientOrderId is DROPPED on");
  console.log("      this path (bybit.js:4326 sits in the else-branch) ⇒ the movable stop has NO");
  console.log("      deterministic handle. Confirm against the captured body above.");

  await capture("enumerate resting stops", wire, () => dry.fetchOpenOrders(SYMBOL, undefined, undefined, { trigger: true }));
  console.log("      expect orderFilter=StopOrder on the SAME endpoint as normal orders.");
  console.log("      There is no planType. A Full-mode stop may not appear here AT ALL —");
  console.log("      that is live test #4, and it decides whether this step survives.");

  await capture("cancel a stop by id", wire, () => dry.cancelOrder("probe-id", SYMBOL, { planType: "pos_loss", trigger: true }));
  console.log("      ⚠ the Bitget params LEAK into the body verbatim (the trigger/stop branch is");
  console.log("      SPOT-ONLY on Bybit). Strip planType and trigger before porting.");

  await capture("clear a Full-mode stop (stopLoss = 0)", wire, () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dry.createOrder(SYMBOL, "market", "sell", 0, undefined, { stopLossPrice: 0, tradingStopEndpoint: true } as any),
  );
  console.log("      EXPECTED TO BE REJECTED BEFORE SENDING — priceToPrecision refuses 0. ccxt");
  console.log("      cannot express the clear, so the raw implicit call must become an engine");
  console.log("      primitive: privatePostV5PositionTradingStop({stopLoss:'0',tpslMode:'Full'})");
  check(
    "the raw trading-stop method exists to fall back on",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (dry as any).privatePostV5PositionTradingStop === "function",
  );

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((error) => {
    console.error("\nERROR:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
