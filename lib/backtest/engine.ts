/**
 * Backtest engine — port of the reference Python pipeline (TEST SIM/).
 *
 * Turns an ATS-Algo bot config (the uploaded JSON) + a TradingView signal CSV
 * into summary metrics per risk profile. This is a faithful reimplementation of
 * `TEST SIM/backtest_simulator.py` (the engine that produces the scenario tables
 * and ultimately selects each profile's sl/be/lev), so the numbers shown in the
 * admin panel line up with the reference outputs in `runs/.../scenario_table_*`.
 *
 * Trade construction (`build_trades`, backtest_simulator.py:124):
 *   - An entry signal executes at the NEXT bar's OPEN (no look-ahead).
 *   - Consecutive same-direction signals pyramid into independent legs.
 *   - An Exit Signal, OR an opposite-direction entry, closes every open leg at
 *     the next bar's open; a fresh position may open on that same bar.
 *   - A signal is "present" when its cell is truthy — numeric 0 / blank = no
 *     signal (matches `_sig_present`). Legs still open at the end are discarded.
 *
 * Per-trade simulation (`simulate_single_trade`, backtest_simulator.py:322):
 *   - Fixed stop at entry ∓ sl% (NOT the CSV "Trailing ATR" column — the real
 *     exports leave it blank and the reference never reads it).
 *   - Each bar in [entry, exit]: check the stop first (skipped on the exit bar),
 *     then scale out through the TP ladder via the bar's high/low. After the
 *     `be`-th rung fills, the stop moves to break-even on the *next* bar.
 *   - Any weight left when the exit bar is reached closes at that bar's open.
 *
 * Metrics mirror the scenario table's NET money columns: fees are charged per
 * fill (taker on entry, maker on TP fills, taker on a stop/generic-exit
 * remainder; a break-even exit is NOT fee'd — see `tradeFees`), profit-factor
 * uses the un-leveraged net return, and the headline
 * return is the leverage-applied compounded equity curve. `avgTrade`
 * (Profit/Trade) is that leveraged net result spread over the trade count.
 *
 * Win-rate is the one metric classified on GROSS (pre-fee) P&L — matching the
 * reference's GROSS win-rate column and the admin's existing per-profile view.
 * A trade that only grazes TP1 and scratches out at break-even therefore counts
 * as a win even when round-trip fees leave it net-flat. (Net win-rate would
 * count those as losses; see the safe profile, which flips between the two.)
 */

export type RiskKey = "safe" | "balanced" | "aggressive";
export type RiskClass = "LOW" | "MEDIUM" | "HIGH";

export const RISK_TO_PROFILE: Record<RiskClass, RiskKey> = {
  LOW: "safe",
  MEDIUM: "balanced",
  HIGH: "aggressive",
};

export type ProfileConfig = {
  tp: number[];
  w: number[];
  sl: number;
  /** Move the stop to break-even after this many TP rungs fill (null/0 = never). */
  be: number | null;
  lev: number;
};

export type BotConfig = {
  name?: string;
  ticker?: string;
  type?: string;
  exchange?: string;
  timeframe?: string;
  optimized_period?: number;
  fees?: { maker_fee_pct?: number; taker_fee_pct?: number };
  profiles: Record<RiskKey, ProfileConfig>;
};

export type Candle = {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  buyEntry: boolean;
  sellEntry: boolean;
  exit: boolean;
};

/** One simulated trade. `ret` is the un-leveraged net return %, `lev` is applied later. */
export type Trade = {
  side: "long" | "short";
  entryIdx: number;
  exitIdx: number;
  entryTime: Date;
  exitTime: Date;
  entry: number;
  /** Gross realized return % (before fees, before leverage). */
  gross: number;
  /** Net realized return % (after fees, before leverage). */
  net: number;
  win: boolean;
};

export type ProfileMetrics = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  /** Compounded net equity return at the profile's leverage, over all trades (%). */
  totalReturn: number;
  /** Mean un-leveraged net return per trade (%). */
  avgTrade: number;
  d30: number;
  d90: number;
  d180: number;
  d360: number;
};

export type BacktestResult = {
  candleCount: number;
  /** Calendar span of the data actually backtested, in days. */
  windowDays: number;
  profiles: Record<RiskKey, ProfileMetrics>;
};

export type BacktestOptions = {
  /**
   * Restrict the headline to trades whose entry AND exit fall within the last N
   * days (anchored on the final candle). 0 / undefined = all trades, which is
   * what the reference scenario table reports. The d30/d90/d180/d360 breakdowns
   * are always trailing windows regardless of this.
   */
  windowDays?: number;
};

const DAY_MS = 86_400_000;
const RISK_KEYS: RiskKey[] = ["safe", "balanced", "aggressive"];
const EPS = 1e-9;

/** Column aliases (case-insensitive) for the TradingView export header. */
const COLS = {
  time: ["time", "ts"],
  open: ["open"],
  high: ["high"],
  low: ["low"],
  close: ["close"],
  buyEntry: ["buy entry signal"],
  sellEntry: ["sell entry signal"],
  exit: ["exit signal"],
} as const;

/**
 * Truthiness test matching the reference `_sig_present`: blank / NaN / numeric
 * zero are "no signal"; any other number or non-empty string is a signal.
 */
function sigPresent(cell: string | undefined): boolean {
  if (cell == null) return false;
  const s = cell.trim();
  if (s === "") return false;
  const n = Number(s);
  if (Number.isNaN(n)) return true; // non-empty, non-numeric string → present
  return n !== 0;
}

/**
 * Parse a TradingView signal CSV into candles. Columns are matched by header
 * name (the real exports carry extra columns like "Adapted Flow"/"Plot"), with
 * a positional fallback for the legacy layout.
 */
export function parseCandles(csvText: string): Candle[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (aliases: readonly string[]) => {
    for (const a of aliases) {
      const i = header.indexOf(a);
      if (i !== -1) return i;
    }
    return -1;
  };

  // Resolve column indices, falling back to the canonical positions when the
  // header is missing the expected names.
  const ix = {
    time: pick(idx(COLS.time), 0),
    open: pick(idx(COLS.open), 1),
    high: pick(idx(COLS.high), 2),
    low: pick(idx(COLS.low), 3),
    close: pick(idx(COLS.close), 4),
    buyEntry: pick(idx(COLS.buyEntry), 9),
    sellEntry: pick(idx(COLS.sellEntry), 10),
    exit: pick(idx(COLS.exit), 11),
  };
  const maxIx = Math.max(...Object.values(ix));

  const out: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = splitCsvLine(lines[i]);
    if (p.length <= maxIx) continue;
    const time = new Date(p[ix.time]);
    if (Number.isNaN(time.getTime())) continue;
    const open = Number(p[ix.open]);
    const high = Number(p[ix.high]);
    const low = Number(p[ix.low]);
    const close = Number(p[ix.close]);
    if ([open, high, low, close].some((x) => Number.isNaN(x))) continue;
    out.push({
      time,
      open,
      high,
      low,
      close,
      buyEntry: sigPresent(p[ix.buyEntry]),
      sellEntry: sigPresent(p[ix.sellEntry]),
      exit: sigPresent(p[ix.exit]),
    });
  }
  // Reference sorts by timestamp before building trades.
  out.sort((a, b) => a.time.getTime() - b.time.getTime());
  return out;
}

function pick(found: number, fallback: number): number {
  return found === -1 ? fallback : found;
}

/** Minimal CSV splitter (handles quoted fields; exports rarely need it). */
function splitCsvLine(line: string): string[] {
  if (line.indexOf('"') === -1) return line.split(",");
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

type OpenLeg = { side: "long" | "short"; entryIdx: number; entry: number };
type RawTrade = {
  side: "long" | "short";
  entryIdx: number;
  exitIdx: number;
  entry: number;
  exit: number;
};

/**
 * Build trades from the signal stream — port of `build_trades`
 * (backtest_simulator.py:124). Entries/exits execute at the next bar's open;
 * same-side signals pyramid; an exit signal or a direction flip closes the
 * whole stack.
 */
function buildTrades(candles: Candle[]): RawTrade[] {
  const trades: RawTrade[] = [];
  let open: OpenLeg[] = [];
  const n = candles.length;

  for (let i = 0; i < n - 1; i++) {
    const c = candles[i];
    const signalSide: "long" | "short" | null = c.buyEntry ? "long" : c.sellEntry ? "short" : null;
    const currentSide = open.length ? open[0].side : null;

    let exitAll = false;
    let newSideAfterExit: "long" | "short" | null = null;

    if (c.exit && open.length) {
      exitAll = true;
      newSideAfterExit = signalSide; // an entry on the same bar can re-open
    } else if (open.length && signalSide !== null && signalSide !== currentSide) {
      exitAll = true;
      newSideAfterExit = signalSide;
    }

    if (exitAll) {
      const exitIdx = i + 1;
      const exitPrice = candles[exitIdx].open;
      for (const leg of open) {
        trades.push({ side: leg.side, entryIdx: leg.entryIdx, exitIdx, entry: leg.entry, exit: exitPrice });
      }
      open = [];
      if (newSideAfterExit !== null) {
        open.push({ side: newSideAfterExit, entryIdx: i + 1, entry: candles[i + 1].open });
      }
      continue;
    }

    if (signalSide !== null && (currentSide === null || signalSide === currentSide)) {
      open.push({ side: signalSide, entryIdx: i + 1, entry: candles[i + 1].open });
    }
  }

  // Legs still open at the end of the data are discarded (no exit).
  return trades;
}

type SimResult = {
  gross: number;
  tpExecWeight: number; // Σ weights filled at TP rungs
  remainderWeight: number; // weight closed at SL / BE / generic exit
  closeReason: "SL" | "BE" | "full_TP" | "generic_exit";
};

/**
 * Simulate one trade bar-by-bar — port of `simulate_single_trade`
 * (backtest_simulator.py:322). Returns the gross realized return % plus the fill
 * breakdown needed to charge fees.
 */
function simulateTrade(candles: Candle[], t: RawTrade, profile: ProfileConfig): SimResult {
  const { tp, w, sl } = profile;
  const be = profile.be && profile.be > 0 ? profile.be : null;
  const entry = t.entry;
  const long = t.side === "long";
  const nTp = tp.length;
  const tpHit = new Array<boolean>(nTp).fill(false);

  let remaining = 1;
  let realized = 0;
  let tpExecWeight = 0;
  let remainderWeight = 0;
  let closeReason: SimResult["closeReason"] = "generic_exit";
  let stop = long ? entry * (1 - sl / 100) : entry * (1 + sl / 100);
  let bePending = false;

  const last = t.exitIdx;
  for (let bar = t.entryIdx; bar <= last; bar++) {
    if (bePending) {
      stop = entry;
      bePending = false;
    }
    const c = candles[bar];
    const isLast = bar === last;

    // Stop / break-even — only off the exit bar (the exit fires at its open).
    const stopHit = long ? c.low <= stop : c.high >= stop;
    if (!isLast && stopHit) {
      remainderWeight = remaining;
      const atBe = Math.abs(stop - entry) < 1e-12;
      closeReason = atBe ? "BE" : "SL";
      realized += remaining * (long ? (stop / entry - 1) * 100 : (entry / stop - 1) * 100);
      remaining = 0;
      break;
    }

    // Scale out through the take-profit ladder.
    for (let k = 0; k < nTp; k++) {
      if (tpHit[k]) continue;
      const tpPrice = long ? entry * (1 + tp[k] / 100) : entry * (1 - tp[k] / 100);
      const hit = long ? c.high >= tpPrice : c.low <= tpPrice;
      if (!hit) continue;
      const wk = w[k] ?? 0;
      realized += wk * (long ? (tpPrice / entry - 1) * 100 : (entry / tpPrice - 1) * 100);
      remaining -= wk;
      tpExecWeight += wk;
      tpHit[k] = true;
      if (be !== null && k + 1 === be) bePending = true;
    }

    if (remaining <= EPS) {
      closeReason = "full_TP";
      remainderWeight = 0;
      remaining = 0;
      break;
    }
  }

  // Anything left closes at the exit bar's open.
  if (remaining > EPS) {
    const lastOpen = candles[last].open;
    remainderWeight = remaining;
    realized += remaining * (long ? (lastOpen / entry - 1) * 100 : (entry / lastOpen - 1) * 100);
    closeReason = "generic_exit";
  }

  return { gross: realized, tpExecWeight, remainderWeight, closeReason };
}

/**
 * NET fee on notional %, charged per fill — based on `evaluate_scenario_net`.
 *
 * Deviation from the reference (intentional, to match the admin's existing app):
 * the portion closed at BREAK-EVEN is NOT charged an exit fee. The reference
 * charges a maker fee there; skipping it makes scratch trades net-flat instead
 * of slightly negative, which is what the existing per-profile view shows. This
 * is the only place the engine departs from `backtest_simulator.py`.
 */
function tradeFees(sim: SimResult, maker: number, taker: number): number {
  const entryFee = taker; // entry: taker on full notional
  let remainderRate: number;
  if (sim.closeReason === "BE") remainderRate = 0; // break-even exit charged no fee (see above)
  else if (sim.closeReason === "SL" || sim.closeReason === "generic_exit") remainderRate = taker;
  else remainderRate = 0; // full_TP: remainder already closed via maker rungs
  const exitFee = sim.tpExecWeight * maker + sim.remainderWeight * remainderRate;
  return entryFee + exitFee;
}

function runProfile(candles: Candle[], raw: RawTrade[], profile: ProfileConfig, fees: BotConfig["fees"]): Trade[] {
  const maker = fees?.maker_fee_pct ?? 0;
  const taker = fees?.taker_fee_pct ?? 0;
  return raw.map((t) => {
    const sim = simulateTrade(candles, t, profile);
    const net = sim.gross - tradeFees(sim, maker, taker);
    return {
      side: t.side,
      entryIdx: t.entryIdx,
      exitIdx: t.exitIdx,
      entryTime: candles[t.entryIdx].time,
      exitTime: candles[t.exitIdx].time,
      entry: t.entry,
      gross: sim.gross,
      net,
      win: sim.gross > 0, // win-rate is classified on gross (pre-fee) P&L
    };
  });
}

/** Compounded equity return % at leverage `lev` (per-trade return floored at -100%). */
function compoundedReturn(nets: number[], lev: number): number {
  let equity = 1;
  for (const r of nets) equity *= 1 + Math.max(r * lev, -100) / 100;
  return (equity - 1) * 100;
}

function summarize(trades: Trade[], lev: number, windowEnd: number): ProfileMetrics {
  const nets = trades.map((t) => t.net);
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

  // Win-rate is classified on GROSS (pre-fee) P&L — see the module header.
  const winCount = trades.filter((t) => t.gross > 0).length;
  const lossCount = trades.filter((t) => t.gross < 0).length;

  // Profit factor uses the NET return, partitioned on its own sign (reference
  // NET rows), so it still reflects fees even when the win-rate does not.
  const grossProfit = sum(nets.filter((r) => r > 0));
  const grossLoss = Math.abs(sum(nets.filter((r) => r < 0)));

  const totalReturn = compoundedReturn(nets, lev);
  const windowReturn = (days: number) =>
    compoundedReturn(
      trades.filter((t) => windowEnd - t.entryTime.getTime() <= days * DAY_MS).map((t) => t.net),
      lev,
    );

  return {
    trades: trades.length,
    wins: winCount,
    losses: lossCount,
    winRate: trades.length ? (winCount / trades.length) * 100 : 0,
    profitFactor: grossLoss < EPS ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss,
    totalReturn,
    // Profit/Trade: leveraged net result spread over the trade count.
    avgTrade: trades.length ? totalReturn / trades.length : 0,
    d30: windowReturn(30),
    d90: windowReturn(90),
    d180: windowReturn(180),
    d360: windowReturn(360),
  };
}

/** Run the backtest for every risk profile in the config. */
export function runBacktest(config: BotConfig, csvText: string, opts: BacktestOptions = {}): BacktestResult {
  const candles = parseCandles(csvText);
  const total = candles.length;
  const lastTime = candles.length ? candles[candles.length - 1].time.getTime() : Date.now();
  const firstTime = candles.length ? candles[0].time.getTime() : lastTime;
  const spanDays = Math.round((lastTime - firstTime) / DAY_MS);

  // Trade construction is profile-independent (signals only); reuse it.
  const raw = buildTrades(candles);
  const cutoff = opts.windowDays && opts.windowDays > 0 ? lastTime - opts.windowDays * DAY_MS : -Infinity;

  const profiles = {} as Record<RiskKey, ProfileMetrics>;
  for (const key of RISK_KEYS) {
    const p = config.profiles?.[key];
    if (!p) {
      profiles[key] = summarize([], 1, lastTime);
      continue;
    }
    const trades = runProfile(candles, raw, p, config.fees).filter(
      (t) => t.entryTime.getTime() >= cutoff,
    );
    profiles[key] = summarize(trades, p.lev ?? 1, lastTime);
  }

  return { candleCount: total, windowDays: spanDays, profiles };
}

/**
 * Cumulative equity curve for one profile — a running, leverage-applied,
 * compounded net-return multiplier (starts at 1) stamped at each trade's exit
 * time. Used by the bot detail view to draw the equity chart.
 */
export function profileEquityCurve(
  config: BotConfig,
  csvText: string,
  key: RiskKey,
): { time: number; equity: number }[] {
  const profile = config.profiles?.[key];
  if (!profile) return [];
  const candles = parseCandles(csvText);
  const trades = runProfile(candles, buildTrades(candles), profile, config.fees);
  const lev = profile.lev ?? 1;
  let equity = 1;
  return trades.map((t) => {
    equity *= 1 + Math.max(t.net * lev, -100) / 100;
    return { time: t.exitTime.getTime(), equity };
  });
}

/** Round a metrics object to display precision for storage/UI. */
export function roundMetrics(m: ProfileMetrics): ProfileMetrics {
  const r2 = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);
  return {
    trades: m.trades,
    wins: m.wins,
    losses: m.losses,
    winRate: r2(m.winRate),
    profitFactor: r2(m.profitFactor),
    totalReturn: r2(m.totalReturn),
    avgTrade: r2(m.avgTrade),
    d30: r2(m.d30),
    d90: r2(m.d90),
    d180: r2(m.d180),
    d360: r2(m.d360),
  };
}
