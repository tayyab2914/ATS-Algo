// BingX account-shape probe — the first thing to run, before any BingX engine code exists.
// Modelled on probe-bybit-account.ts and probe-blofin-account.ts: READ-ONLY plus DRY-RUN, so it
// places no orders, cancels nothing, and changes no account setting. Mutating calls are captured
// at the HTTP boundary and discarded, so the request bodies printed below are the real ones the
// adapter would have sent, built against real market descriptors — not written from memory.
//
// BingX differs from all three wired venues in ways that have to be settled before the adapter
// is written:
//
//   1. THE SAME KEY WORKS ON BOTH HOSTS. Demo (VST) is a hostname swap, not a separate
//      credential — unlike Bitget (header on the live host), Bybit (api-demo, its own key) and
//      BloFin (demo-trading host, its own key). validateExchangeKey's live-then-demo probe
//      therefore classifies EVERY BingX key as live, and a member has no way to say "paper".
//   2. THE KEY'S SCOPE IS READABLE. `GET /openApi/v1/account/apiPermissions` returns the
//      permission set. No other venue exposes this, and it is exactly what detectWithdrawScope()
//      in lib/exchanges/validate.ts was left as an extension point for: on BingX we can REFUSE a
//      withdraw-enabled key instead of merely labelling it "withdrawal unverified".
//   3. THE BATCH CAP IS 5, not 50 (Bitget) or 10 (Bybit) — and ccxt THROWS rather than
//      truncating. A 6-rung ladder must be chunked.
//   4. THE ATTACHED STOP IS SIZED. ccxt defaults the attached stop's `quantity` to the entry
//      amount (bingx.js:3189), i.e. BloFin's shape, not Bybit's sizeless one. Whether a sized
//      reduce-only stop is STARVED behind a full-size reduce-only TP ladder is the question that
//      decides this venue — Bitget starves it, BloFin does not. This probe cannot answer that
//      (it places no orders); it is the first live test.
//
//   npx tsx scripts/probe-bingx-account.ts
//
// No passphrase: ccxt's bingx adapter inherits `password: false`.
import "dotenv/config";
import ccxt, { type Exchange, type MarketInterface } from "ccxt";

const SYMBOL = "BTC/USDT:USDT";
const CHECKS = ["BTC/USDT:USDT", "ETH/USDT:USDT", "SOL/USDT:USDT"];
const LEVERAGE = 5;

/** BingX permission codes, from BingX's own subAccount apiKey/create reference. */
const PERMISSION_NAMES: Record<number, string> = {
  1: "Spot Trading",
  2: "Read",
  3: "Perpetual Futures Trading",
  4: "Universal Transfer",
  5: "Withdraw",
  7: "Internal Transfer",
};
const PERM_READ = 2;
const PERM_PERP = 3;
const PERM_WITHDRAW = 5;

const key = process.env.BINGX_DEMO_KEY?.trim();
const secret = process.env.BINGX_DEMO_SECRET?.trim();

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? `  ${detail}` : ""}`);
};
const note = (label: string, value: unknown) => console.log(`  · ${label}: ${String(value)}`);
const answer = (label: string, value: string) => console.log(`  ★ ${label}: ${value}`);

class DryRun extends Error {}
type Wire = { method: string; url: string; body: unknown };

function client(sandbox: boolean): Exchange {
  const ex = new ccxt.bingx({
    apiKey: key, secret,
    enableRateLimit: true, timeout: 20_000,
    // bingx's defaultType is 'spot' (bingx.js:610) — every venue before this one defaulted
    // usefully or was set anyway, so this is easy to forget and silently trades the wrong book.
    options: { defaultType: "swap" },
  });
  // A pure hostname swap to open-api-vst: no header (Bitget), no separate host family the key
  // does not belong to (Bybit testnet). setSandboxMode is CORRECT here, unlike on Bybit.
  if (sandbox) ex.setSandboxMode(true);
  ex.has["fetchCurrencies"] = false; // private on bingx; keep loadMarkets to public data
  return ex;
}

/** A client whose transport is severed, so a mutating call yields its request body only. */
function dryRunClient(markets: MarketInterface[]): { ex: Exchange; wire: Wire[] } {
  const ex = new ccxt.bingx({ apiKey: "dry", secret: "dry", options: { defaultType: "swap" } });
  ex.setSandboxMode(true);
  ex.setMarkets(markets);
  const wire: Wire[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ex as any).fetch = async (url: string, method = "GET", _h?: unknown, body?: string) => {
    let parsed: unknown = body;
    try { parsed = body ? JSON.parse(body) : undefined; } catch { /* not JSON, keep raw */ }
    // BingX signs and sends EVERYTHING in the query string, including POSTs — there is no
    // JSON body to read, unlike Bitget/Bybit/BloFin. Reading only `body` here silently
    // captured `undefined` for every call and made three assertions below look like
    // failures when the request was in fact correct.
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const qs = path.indexOf("?");
    if (parsed === undefined && qs >= 0) {
      const params: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(path.slice(qs + 1))) {
        if (k === "signature" || k === "timestamp") continue; // noise, and never stable
        params[k] = v;
      }
      parsed = params;
    }
    wire.push({ method, url: qs >= 0 ? path.slice(0, qs) : path, body: parsed });
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
      // A throw BEFORE the transport is itself a finding: ccxt refused to build the request.
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
  if (!key || !secret) throw new Error("BINGX_DEMO_KEY / BINGX_DEMO_SECRET missing from .env");

  // ── 1. THE SAME KEY ON BOTH HOSTS ───────────────────────────────────────────
  console.log("── auth: live and VST with ONE credential ──");
  const live = client(false);
  const demo = client(true);
  note("live host", JSON.stringify(live.urls.api).match(/https:\/\/[^/"]+/)?.[0]);
  note("demo host", JSON.stringify(demo.urls.api).match(/https:\/\/[^/"]+/)?.[0]);
  check("demo host is the VST engine", JSON.stringify(demo.urls.api).includes("open-api-vst"));

  const totalsOf = async (ex: Exchange) => {
    const bal = await ex.fetchBalance();
    return (bal.total ?? {}) as unknown as Record<string, number | undefined>;
  };
  const liveOk = await totalsOf(live).then((t) => ({ ok: true as const, t }), (e: unknown) => ({ ok: false as const, e }));
  const demoOk = await totalsOf(demo).then((t) => ({ ok: true as const, t }), (e: unknown) => ({ ok: false as const, e }));
  check("key authenticates on LIVE", liveOk.ok, liveOk.ok ? `USDT=${Number(liveOk.t.USDT ?? 0)}` : String(liveOk.e).slice(0, 90));
  check("key authenticates on VST", demoOk.ok, demoOk.ok ? `VST=${Number(demoOk.t.VST ?? 0)}` : String(demoOk.e).slice(0, 90));
  if (liveOk.ok && demoOk.ok) {
    answer(
      "PAPER/LIVE IS NOT A KEY PROPERTY",
      "one credential authenticates on BOTH hosts, so validateExchangeKey's live-then-demo " +
        "probe will mark every BingX key sandbox:false. Paper has to become an explicit choice.",
    );
  }
  const vst = demoOk.ok ? Number(demoOk.t.VST ?? 0) : 0;
  check("VST wallet is funded", vst > 0, `VST=${vst}`);
  check("enough headroom for a 6-rung ladder", vst >= 200, `need ~200+, have ${vst}`);

  // ── 2. THE KEY'S OWN SCOPE — readable here, nowhere else ────────────────────
  console.log("\n── API key scope (the capability Bitget never had) ──");
  type Perms = { permissions?: number[]; ipAddresses?: string[]; note?: string };
  const permsCall = (live as Exchange & { accountV1PrivateGetAccountApiPermissions?: () => Promise<Perms> })
    .accountV1PrivateGetAccountApiPermissions;
  check("ccxt exposes GET account/apiPermissions", typeof permsCall === "function");
  if (typeof permsCall === "function") {
    const raw = await permsCall.call(live);
    // BingX's PUBLISHED response shape for this endpoint is Binance-style booleans
    // (enableReading / enableFutures / enableWithdrawals …). The endpoint ACTUALLY returns a
    // numeric array. Parse both, and never assume the doc.
    const codes = Array.isArray(raw.permissions) ? raw.permissions.map(Number) : [];
    const named = codes.map((c) => PERMISSION_NAMES[c] ?? `unknown(${c})`);
    note("permission codes", `${JSON.stringify(codes)} = ${named.join(", ")}`);
    note("label", raw.note);
    note("ipAddresses", JSON.stringify(raw.ipAddresses ?? []));
    check("has Read", codes.includes(PERM_READ));
    check("has Perpetual Futures Trading", codes.includes(PERM_PERP));
    check("WITHDRAW IS NOT GRANTED", !codes.includes(PERM_WITHDRAW));
    check("no Spot / Universal Transfer / Subaccount scope", codes.every((c) => c === PERM_READ || c === PERM_PERP), JSON.stringify(named));
    const ipBound = (raw.ipAddresses ?? []).length > 0;
    answer(
      "KEY LIFETIME",
      ipBound
        ? "IP-bound ⇒ never expires"
        : "NO IP bound + trade scope ⇒ BingX DELETES this key after 14 consecutive days with no " +
          "API call. scanForOrphans only polls active:true deployments, so a connected-but-idle " +
          "member's key dies silently.",
    );
    answer(
      "WITHDRAW ENFORCEMENT",
      "enforceable on BingX — reject a key carrying code 5 at connect time, instead of the " +
        "\"withdrawal unverified\" label the other three venues are stuck with.",
    );
  }

  // ── 3. sizing and instruments ───────────────────────────────────────────────
  console.log("\n── sizing: base units or contracts? ──");
  await demo.loadMarkets();
  const market = demo.market(SYMBOL);
  note("market.id", market.id);
  note("contractSize", market.contractSize);
  note("limits.amount.min", market.limits?.amount?.min);
  note("precision.amount", market.precision.amount);
  note("precision.price", market.precision.price);
  note("limits.cost.min", market.limits?.cost?.min ?? "none");
  const contractSize = Number(market.contractSize ?? 1);
  answer(
    "DENOMINATION",
    contractSize === 1
      ? "contractSize 1 ⇒ BASE UNITS like Bitget/Bybit; BloFin's sizeFromMargin(contractSize) seam is a no-op here"
      : `contractSize ${contractSize} ⇒ CONTRACT-DENOMINATED like BloFin; every size needs conversion`,
  );
  const minAmount = Number(market.limits?.amount?.min ?? 0);
  answer("MINIMUM ORDER", `${minAmount} × ${contractSize} = ${(minAmount * contractSize).toPrecision(4)} BTC (Bitget 0.0001, Bybit 0.001)`);
  check("limits.cost.min is present (planLadder's min-notional guard needs it)", market.limits?.cost?.min != null,
    market.limits?.cost?.min == null ? "ABSENT — the guard silently no-ops, as on Bybit" : "");

  const isPerp = (m: MarketInterface) => Boolean(m.swap && m.linear && m.quote === "USDT" && m.active);
  for (const s of CHECKS) {
    const m = demo.markets[s] as MarketInterface | undefined;
    check(`VST lists ${s}`, Boolean(m && isPerp(m)), m ? `id=${m.id} contractSize=${m.contractSize} min=${m.limits?.amount?.min}` : "absent");
  }
  const demoPerps = Object.values(demo.markets as Record<string, MarketInterface>).filter(isPerp);
  note("VST USDT linear perps", demoPerps.length);
  const pub = client(false);
  await pub.loadMarkets();
  const livePerps = Object.values(pub.markets as Record<string, MarketInterface>).filter(isPerp);
  note("live USDT linear perps", livePerps.length);
  const missing = livePerps.filter((m) => !demo.markets[m.symbol]).map((m) => m.symbol);
  note("listed live but NOT on VST", missing.length);
  if (missing.length > 0) console.log(`      ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " …" : ""}`);
  // A venue property, not a defect — so it is reported, not scored. Bitget's paper venue lists
  // ~51 of ~1950 (the reason DEMO_FALLBACK_SYMBOL exists at all) and Bybit's demo is complete.
  answer(
    "VST COVERAGE",
    missing.length === 0
      ? "complete — a bot's real instrument can be exercised on paper, no substitution"
      : `${missing.length} of ${livePerps.length} live perps are absent from VST ⇒ ` +
        "DEMO_FALLBACK_SYMBOL is still required, but only for those few",
  );

  // ── 4. capabilities the engine depends on ───────────────────────────────────
  console.log("\n── capabilities ──");
  for (const cap of ["fetchOrder", "fetchOpenOrders", "fetchClosedOrders", "createOrders", "fetchMyTrades", "fetchPositions", "fetchMarginMode", "setMarginMode", "setPositionMode", "setLeverage", "closePosition", "cancelAllOrders"]) {
    console.log(`  ${demo.has[cap] ? "✓" : "✗"} has.${cap} = ${String(demo.has[cap])}`);
  }
  check("fetchOrder EXISTS (BloFin's readFill seam not needed)", demo.has["fetchOrder"] === true);
  const features = demo.features as Record<string, Record<string, Record<string, { max?: number }>> | undefined> | undefined;
  const batchMax = features?.swap?.linear?.createOrders?.max ?? (demo.features as Record<string, Record<string, { max?: number }> | undefined> | undefined)?.defaultForLinear?.createOrders?.max;
  answer("BATCH CAP", `${batchMax} per createOrders call (Bitget 50, Bybit 10) — ccxt THROWS above it, so a 6-rung ladder MUST be chunked`);

  const marginMode = await (demo as Exchange & { fetchMarginMode?: (s: string) => Promise<unknown> })
    .fetchMarginMode?.(SYMBOL).then((m) => JSON.stringify(m), (e: unknown) => `THREW ${String(e).slice(0, 110)}`);
  answer("ACCOUNT MARGIN MODE (read)", String(marginMode));
  const positionModeRaw = await (demo as Exchange & { fetchPositionMode?: (s?: string) => Promise<{ hedged?: boolean }> })
    .fetchPositionMode?.(SYMBOL).then((m) => m, () => undefined);
  answer("ACCOUNT POSITION MODE (read)", JSON.stringify(positionModeRaw));
  // Every bot is swing/one-way: a new entry reverses the previous position. In hedge mode the
  // reversal opens a SECOND position instead of closing the first — the 40774 class of bug that
  // cost a day on Bitget, except here it is readable up front.
  check("account is in ONE-WAY mode", positionModeRaw?.hedged === false,
    positionModeRaw?.hedged ? "HEDGE mode — must be switched before any live test" : "");

  // ── 5. what would go on the wire ────────────────────────────────────────────
  console.log("\n── dry-run: prep ──");
  const { ex: dry, wire } = dryRunClient([market]);
  const hasSymbol = (w: Wire | null) => Boolean(w && (w.body as Record<string, string> | undefined)?.symbol);

  const posModeReq = await capture("setPositionMode(false) — one-way", wire, () => dry.setPositionMode(false, SYMBOL));
  answer(
    "POSITION MODE SCOPE",
    hasSymbol(posModeReq)
      ? "per-symbol — safe to SET, like Bitget"
      : "ACCOUNT-GLOBAL (no symbol on the wire) — setting it would reconfigure every position " +
        "the member holds, so it takes the same check-don't-change policy as Bybit/BloFin margin mode",
  );

  const marginReq = await capture("setMarginMode('isolated')", wire, () => dry.setMarginMode("isolated", SYMBOL));
  answer(
    "MARGIN MODE SCOPE",
    hasSymbol(marginReq)
      ? "PER-SYMBOL — safe to SET, like Bitget (marginModePolicy 'set')"
      : "account-global — check-don't-change, like Bybit/BloFin",
  );

  await capture("setLeverage(lev, symbol) — no side", wire, () => dry.setLeverage(LEVERAGE, SYMBOL));
  console.log("      EXPECTED TO BE REJECTED: ccxt's bingx demands an explicit side. The engine");
  console.log("      calls setLeverage(lev, symbol) for Bitget/Bybit, so that call THROWS here.");
  const levReq = await capture("setLeverage with side BOTH (one-way mode)", wire, () =>
    dry.setLeverage(LEVERAGE, SYMBOL, { side: "BOTH" }));
  check("side BOTH is accepted for a one-way account", levReq !== null,
    "if this is rejected too, leverage must be armed LONG and SHORT separately");

  console.log("\n── dry-run: the order path ──");
  const size = Number(dry.amountToPrecision(SYMBOL, Math.max(minAmount, contractSize === 1 ? 0.01 : 1)));
  const entry = await capture("entry: market + attached stop", wire, () =>
    dry.createOrder(SYMBOL, "market", "buy", size, undefined, {
      clientOrderId: "probe-entry-1", stopLoss: { triggerPrice: 50_000 },
    }));
  const entryBody = (entry?.body ?? {}) as Record<string, unknown>;
  const attached = typeof entryBody.stopLoss === "string" ? JSON.parse(entryBody.stopLoss) : entryBody.stopLoss;
  check("attached stop is SIZED (BloFin's shape, not Bybit's sizeless one)",
    Boolean(attached && (attached as Record<string, unknown>).quantity !== undefined),
    JSON.stringify(attached));
  check("one-way mode sends positionSide BOTH", entryBody.positionSide === "BOTH", String(entryBody.positionSide));
  check("client id lands in clientOrderID (capital D, swap-only field)", entryBody.clientOrderID === "probe-entry-1", JSON.stringify(entryBody.clientOrderID));
  console.log("      ⚠ SIZED + reduce-only is the shape Bitget STARVES behind a reduce-only TP");
  console.log("      ladder and BloFin does not. That is live test #1 and it decides the venue.");

  console.log("\n  batch cap:");
  const rung = (i: number, px: number) => ({
    symbol: SYMBOL, type: "limit" as const, side: "sell" as const, amount: size, price: px,
    params: { reduceOnly: true, clientOrderId: `probe-tp-${i}` },
  });
  await capture("TP ladder, 5 rungs (at the cap)", wire, () =>
    dry.createOrders([rung(0, 130_000), rung(1, 131_000), rung(2, 132_000), rung(3, 133_000), rung(4, 134_000)]));
  await capture("TP ladder, 6 rungs (over the cap)", wire, () =>
    dry.createOrders([rung(0, 130_000), rung(1, 131_000), rung(2, 132_000), rung(3, 133_000), rung(4, 134_000), rung(5, 135_000)]));
  console.log("      the 6-rung call MUST be rejected before sending — ccxt throws InvalidOrder");
  console.log("      rather than truncating (bingx.js:3412). Chunking is mandatory, not an");
  console.log("      optimisation, and a silent truncation would have been far worse.");

  console.log("");
  const stopReq = await capture("movable stop via stopLossPrice", wire, () =>
    dry.createOrder(SYMBOL, "market", "sell", size, undefined, { stopLossPrice: 50_000, clientOrderId: "probe-stop-1" }));
  const stopBody = (stopReq?.body ?? {}) as Record<string, string>;
  check("stop is STOP_MARKET", stopBody.type === "STOP_MARKET", String(stopBody.type));
  // bingx.js:3144 sets a LOCAL reduceOnly = true, but ccxt never writes request['reduceOnly'] —
  // the flag reaches the wire only by passthrough of the caller's params, and in HEDGE mode it is
  // omitted outright and translated into positionSide. So on a one-way account that assignment is
  // dead for the request: the movable stop goes out as a PLAIN STOP_MARKET.
  answer(
    "MOVABLE STOP IS NOT FLAGGED REDUCE-ONLY",
    stopBody.reduceOnly === undefined
      ? "no reduceOnly on the wire. In one-way mode a SELL STOP_MARKET reduces an open long — " +
        "but if the position is already gone, does it OPEN a naked short? Bitget/Bybit/BloFin all " +
        "mark their stops reduce-only, so this failure mode is new. LIVE TEST #3."
      : `reduceOnly=${stopBody.reduceOnly} present after all — re-read bingx.js:3132-3144`,
  );
  console.log("      NOTE: passing reduceOnly:true explicitly DOES reach the wire (the ladder legs");
  console.log("      above carry it), so the fix is ours to make, not a ccxt limitation.");
  await capture("enumerate open orders (plain)", wire, () => dry.fetchOpenOrders(SYMBOL));
  await capture("enumerate open orders (trigger)", wire, () => dry.fetchOpenOrders(SYMBOL, undefined, undefined, { trigger: true }));
  console.log("      if both hit the SAME endpoint, a bare cancelAllOrders may sweep the backstop");
  console.log("      — the Bybit failure mode. Live test #2.");
  await capture("cancel one order by id", wire, () => dry.cancelOrder("probe-id", SYMBOL));
  await capture("cancelAllOrders(symbol)", wire, () => dry.cancelAllOrders(SYMBOL));

  console.log(failures === 0 ? "\nPASS" : `\nFAIL (${failures})`);
}

main()
  .then(() => process.exit(failures === 0 ? 0 : 1))
  .catch((e) => { console.error("\nERROR:", e instanceof Error ? e.message : e); process.exit(1); });
