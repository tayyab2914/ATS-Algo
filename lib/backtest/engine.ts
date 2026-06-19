/**
 * Backtest engine (v0) — swappable.
 *
 * Turns an ATS-Algo bot config (the uploaded JSON) + a signal CSV into summary
 * metrics per risk profile. The CSV already carries entry/exit signals and a
 * per-bar `Trailing ATR` stop level; this engine simulates scaling out through
 * the profile's take-profit ladder, moving the stop to breakeven after `be`
 * rungs, and closing on an exit signal, an opposite-signal flip, or a stop hit.
 *
 * Calibration status: the trade set, 180-day window, per-bar ATR stop and
 * leverage are confirmed against the reference engine's output. The exact
 * scratch=win rule and a couple of intrabar fill orderings still need the
 * source engine's per-trade export to pin down — kept behind `BacktestOptions`
 * so the headline numbers can be finalized without touching callers.
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
  be: number;
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
  trailATR: number | null;
  buyEntry: boolean;
  sellEntry: boolean;
  exit: boolean;
};

export type Trade = {
  side: "long" | "short";
  entryTime: string;
  exitTime: string;
  entry: number;
  ret: number;
  win: boolean;
};

export type ProfileMetrics = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalReturn: number;
  avgTrade: number;
  d30: number;
  d90: number;
  d180: number;
  d360: number;
};

export type BacktestResult = {
  candleCount: number;
  windowDays: number;
  profiles: Record<RiskKey, ProfileMetrics>;
};

export type BacktestOptions = {
  /** Backtest only the last N days (default 180, the JSON optimized_period). 0 = all. */
  windowDays?: number;
};

const DAY_MS = 86_400_000;
const RISK_KEYS: RiskKey[] = ["safe", "balanced", "aggressive"];

/**
 * Parse the signal CSV. Expected header columns:
 * time, open, high, low, close, Buy, Sell, Baseline, Trailing ATR,
 * Buy Entry Signal, Sell Entry Signal, Exit Signal, Volume
 */
export function parseCandles(csvText: string): Candle[] {
  const lines = csvText.trim().split(/\r?\n/);
  const out: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    if (p.length < 12) continue;
    const time = new Date(p[0]);
    if (Number.isNaN(time.getTime())) continue;
    out.push({
      time,
      open: Number(p[1]),
      high: Number(p[2]),
      low: Number(p[3]),
      close: Number(p[4]),
      trailATR: p[8] === "" || p[8] == null ? null : Number(p[8]),
      buyEntry: p[9] === "1",
      sellEntry: p[10] === "1",
      exit: p[11] === "1",
    });
  }
  return out;
}

type OpenPosition = {
  side: "long" | "short";
  entry: number;
  time: Date;
  realized: number; // realized price-move %, before leverage
  remaining: number; // open fraction of the position (1 → 0)
  hits: number; // TP rungs filled
  stop: number;
};

function runProfile(candles: Candle[], profile: ProfileConfig, fees: BotConfig["fees"]): Trade[] {
  const { tp, w, sl, be, lev } = profile;
  const taker = (fees?.taker_fee_pct ?? 0) / 100;
  const feePerTrade = taker * 2 * 100 * lev; // entry + exit, on leveraged notional, in %

  const openPos = (side: "long" | "short", c: Candle): OpenPosition => ({
    side,
    entry: c.close,
    time: c.time,
    realized: 0,
    remaining: 1,
    hits: 0,
    stop: c.trailATR ?? (side === "long" ? c.close * (1 - sl / 100) : c.close * (1 + sl / 100)),
  });

  // Close any open fraction at `price`, then turn the position into a Trade.
  const finalize = (p: OpenPosition, price: number, exitTime: Date): Trade => {
    const dir = p.side === "long" ? 1 : -1;
    const realized = p.realized + p.remaining * dir * ((price - p.entry) / p.entry) * 100;
    const ret = realized * lev - feePerTrade;
    return {
      side: p.side,
      entryTime: p.time.toISOString(),
      exitTime: exitTime.toISOString(),
      entry: p.entry,
      ret,
      win: ret > 0,
    };
  };

  const trades: Trade[] = [];
  let pos: OpenPosition | null = null;

  for (const c of candles) {
    if (pos !== null) {
      const p = pos;
      const dir = p.side === "long" ? 1 : -1;

      // Trailing stop comes from the CSV's per-bar ATR level (trails toward price).
      if (c.trailATR != null) p.stop = p.side === "long" ? Math.max(p.stop, c.trailATR) : Math.min(p.stop, c.trailATR);

      // Scale out through the take-profit ladder (intrabar, via high/low).
      for (let k = p.hits; k < tp.length; k++) {
        const tpPrice = p.entry * (1 + dir * (tp[k] / 100));
        const hit = p.side === "long" ? c.high >= tpPrice : c.low <= tpPrice;
        if (!hit) break;
        p.realized += (w[k] ?? 0) * tp[k];
        p.remaining -= w[k] ?? 0;
        p.hits = k + 1;
        if (p.hits >= be) p.stop = p.entry; // move to breakeven
      }

      // Stop hit closes the remainder.
      const stopHit = p.side === "long" ? c.low <= p.stop : c.high >= p.stop;
      if (p.remaining > 1e-9 && stopHit) {
        p.realized += p.remaining * dir * ((p.stop - p.entry) / p.entry) * 100;
        p.remaining = 0;
      }

      if (p.remaining <= 1e-9) {
        trades.push(finalize(p, p.entry, c.time)); // remainder already realized
        pos = null;
      } else if (c.exit) {
        trades.push(finalize(p, c.close, c.time));
        pos = null;
      } else if (p.side === "long" && c.sellEntry) {
        trades.push(finalize(p, c.close, c.time));
        pos = openPos("short", c);
      } else if (p.side === "short" && c.buyEntry) {
        trades.push(finalize(p, c.close, c.time));
        pos = openPos("long", c);
      }
      continue;
    }

    if (c.buyEntry) pos = openPos("long", c);
    else if (c.sellEntry) pos = openPos("short", c);
  }

  // A position still open at the end of the data is incomplete — discard it.
  return trades;
}

function summarize(trades: Trade[], windowEnd: number): ProfileMetrics {
  const rets = trades.map((t) => t.ret);
  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win);
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

  const grossProfit = sum(wins.map((t) => t.ret));
  const grossLoss = Math.abs(sum(losses.map((t) => t.ret)));
  const windowSum = (days: number) =>
    sum(trades.filter((t) => windowEnd - new Date(t.exitTime).getTime() <= days * DAY_MS).map((t) => t.ret));

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss < 1e-9 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss,
    totalReturn: sum(rets),
    avgTrade: trades.length ? sum(rets) / trades.length : 0,
    d30: windowSum(30),
    d90: windowSum(90),
    d180: windowSum(180),
    d360: windowSum(360),
  };
}

/** Run the backtest for every risk profile in the config. */
export function runBacktest(config: BotConfig, csvText: string, opts: BacktestOptions = {}): BacktestResult {
  const windowDays = opts.windowDays ?? config.optimized_period ?? 180;
  let candles = parseCandles(csvText);
  const total = candles.length;
  if (windowDays > 0 && candles.length) {
    const cutoff = candles[candles.length - 1].time.getTime() - windowDays * DAY_MS;
    candles = candles.filter((c) => c.time.getTime() >= cutoff);
  }
  const windowEnd = candles.length ? candles[candles.length - 1].time.getTime() : Date.now();

  const profiles = {} as Record<RiskKey, ProfileMetrics>;
  for (const key of RISK_KEYS) {
    const p = config.profiles?.[key];
    profiles[key] = p
      ? summarize(runProfile(candles, p, config.fees), windowEnd)
      : summarize([], windowEnd);
  }

  return { candleCount: total, windowDays, profiles };
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
