/**
 * The bot configuration an admin uploads, and the risk profile a deployment
 * trades with.
 *
 * Deliberately standalone — no imports, pure declarations — so the LIVE
 * execution path can read a bot's ladder without pulling in the backtest engine.
 * The platform never backtests at trade time: TradingView's Strategy Tester does
 * that, and the uploaded CSV is only parsed into stored metrics. Nothing under
 * `lib/execution/` may import from `lib/backtest/`.
 *
 * `lib/backtest/engine.ts` re-exports everything here, so existing importers are
 * unaffected.
 */

export type RiskKey = "safe" | "balanced" | "aggressive";
export type RiskClass = "LOW" | "MEDIUM" | "HIGH";

export const RISK_TO_PROFILE: Record<RiskClass, RiskKey> = {
  LOW: "safe",
  MEDIUM: "balanced",
  HIGH: "aggressive",
};

export const RISK_KEYS: RiskKey[] = ["safe", "balanced", "aggressive"];

/** Which way a position points. Declared locally to keep this file import-free. */
export type StopSide = "LONG" | "SHORT";

/**
 * Assumed adverse fill on a market stop, in percent, when a config doesn't carry
 * its own. Slippage is a property of the INSTRUMENT, so real configs set
 * `slippage_pct` per ticker; this is only the floor for legacy configs.
 */
export const DEFAULT_SLIPPAGE_PCT = 0.05;

export type ProfileConfig = {
  /**
   * Take-profit rung distances from entry, in percent. **Not necessarily
   * ascending** — a real config has `aggressive.tp = [0.5, 0.45, …]`, so rung 2
   * is nearer than rung 1 and fills first.
   */
  tp: number[];
  /** Fraction of the position closed at each rung; `w[k]` pairs with `tp[k]`. */
  w: number[];
  /** Stop-loss distance from entry, in percent. */
  sl: number;
  /**
   * 1-based **index** of the rung whose fill moves the stop to break-even
   * (null/0 = never). `be: 2` means "when `tp[1]` fills", NOT "once any two
   * rungs have filled" — since the ladder isn't always ascending, counting fills
   * would arm break-even off the wrong rung. See {@link beRungIndex}.
   *
   * @deprecated Superseded by {@link ProfileConfig.sl_tighten_pct}, but NOT
   * removable: stored configs are never re-validated, so a legacy config must keep
   * behaving exactly as it does today.
   */
  be: number | null;
  /**
   * Progressive stop ratchet: after EACH take-profit rung fills, the stop tightens
   * toward entry by this percentage of the ORIGINAL stop distance — LINEARLY, and
   * it may cross entry to LOCK PROFIT.
   *
   *     d(n) = sl × (1 − n × sl_tighten_pct/100)      n = rungs FILLED
   *
   * With `sl: 4, sl_tighten_pct: 25` → n=2: 2% below entry · n=4: AT entry ·
   * n=5: 1% ABOVE entry (profit locked).
   *
   * **Its PRESENCE is the gate.** Absent ⇒ the engine runs the legacy one-shot
   * `be` rule instead, byte-identical to today. So the ladder goes live for a bot
   * exactly when the simulator starts emitting this field — never before.
   */
  sl_tighten_pct?: number | null;
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
  /** Assumed adverse fill on a market stop, per TICKER. Feeds the stop buffer. */
  slippage_pct?: number;
  profiles: Record<RiskKey, ProfileConfig>;
};

/** The single profile this bot trades, selected by its risk class. */
export function profileFor(config: BotConfig, riskClass: RiskClass): ProfileConfig | undefined {
  return config.profiles?.[RISK_TO_PROFILE[riskClass]];
}

/**
 * Index into `tp[]`/`w[]` of the rung whose fill arms break-even, or null when
 * the profile never moves its stop. Guards an out-of-range `be`.
 */
export function beRungIndex(profile: ProfileConfig): number | null {
  const be = profile.be;
  if (be == null || be <= 0 || be > profile.tp.length) return null;
  return be - 1;
}

// ── Progressive stop ladder ──────────────────────────────────────────────────
//
// Sign convention, used everywhere below. A stop distance `d` is SIGNED, in
// percent from the entry:
//
//     d > 0   stop on the LOSS side    (below entry for a LONG, above for a SHORT)
//     d = 0   stop exactly AT entry
//     d < 0   stop on the PROFIT side  (above entry for a LONG, below for a SHORT)
//
// `slPrice(entry, d, side)` in lib/execution/pricing.ts already honours this for
// both sides — a negative `d` genuinely prices the stop into profit.

/**
 * What the deployment ACTUALLY traded, frozen onto the Position at open.
 *
 * The stop maths must never read the live bot config: an admin editing the bot —
 * or its risk class — while a position is open would otherwise change `sl`, the
 * ladder, even `tp[]`, *underneath that open trade*. Everything the stop needs is
 * copied here once and read from here forever.
 */
export type ProfileSnapshot = {
  tp: number[];
  w: number[];
  sl: number;
  be: number | null;
  sl_tighten_pct: number | null;
  lev: number;
  takerFeePct: number;
  slippagePct: number;
};

/** Freeze the profile (and the fee/slippage assumptions) a position will trade on. */
export function snapshotProfile(config: BotConfig, profile: ProfileConfig): ProfileSnapshot {
  return {
    tp: [...profile.tp],
    w: [...profile.w],
    sl: profile.sl,
    be: profile.be ?? null,
    sl_tighten_pct: profile.sl_tighten_pct ?? null,
    lev: profile.lev,
    takerFeePct: Number(config.fees?.taker_fee_pct ?? 0),
    slippagePct: Number(config.slippage_pct ?? DEFAULT_SLIPPAGE_PCT),
  };
}

/** The configured ratchet, or null when this profile has none. THE GATE. */
export function ratchetPct(p: { sl_tighten_pct?: number | null }): number | null {
  const t = p.sl_tighten_pct;
  return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : null;
}

/** LINEAR ratchet distance after `n` filled rungs. Negative ⇒ the stop locks profit. */
export const ratchetDistancePct = (sl: number, tightenPct: number, n: number): number =>
  sl * (1 - (n * tightenPct) / 100);

/** Round-trip cost of being stopped out: two taker fills plus assumed slippage. */
export const stopBufferPct = (takerFeePct: number, slippagePct: number): number =>
  2 * takerFeePct + slippagePct;

/**
 * The n-th NEAREST take-profit distance — `[...tp].sort(asc)[n-1]`.
 *
 * Nearest-by-PRICE, never by rung index: the ladder is non-monotonic
 * (`aggressive.tp = [0.5, 0.45, …]`), and price fills rungs in price order, so
 * after `n` fills it is the `n` NEAREST rungs that have gone. Indexing by rung
 * order would compare the stop against a level price has not actually reached.
 */
export function nthNearestTp(tp: number[], n: number): number | null {
  if (n < 1 || n > tp.length) return null;
  return [...tp].sort((a, b) => a - b)[n - 1];
}

/**
 * The TIGHTEST distance the stop may legally take once `tpNearestPct` has been
 * reached — a LOWER BOUND on the signed distance, for both sides.
 *
 * A stop must never sit at or through the profit level price has already touched:
 * do that and it is either a wrong-side trigger (Bitget silently re-files it as
 * something else, with no error) or an exit that gives the gain back in fees. So
 * it must stay `buffer` inside that level.
 *
 *   LONG   stop ≤ entry·(1 + tp/100)·(1 − b/100)  ⇒  d ≥ 100·(1 − (1+tp/100)(1−b/100))
 *   SHORT  stop ≥ entry·(1 − tp/100)·(1 + b/100)  ⇒  d ≥ 100·((1−tp/100)(1+b/100) − 1)
 */
export function minDistancePct(tpNearestPct: number, bufferPct: number, side: StopSide): number {
  return side === "LONG"
    ? 100 * (1 - (1 + tpNearestPct / 100) * (1 - bufferPct / 100))
    : 100 * ((1 - tpNearestPct / 100) * (1 + bufferPct / 100) - 1);
}

export type StopRule = "FIXED" | "BE" | "RATCHET";

export type StopPlan = {
  /** Ratchet generation. 0 = the entry's attached preset — nothing to place. */
  step: number;
  /** Signed distance from entry, %. */
  distancePct: number;
  rule: StopRule;
  /**
   * True when this step breaches the G2 floor. Validation rejects such configs at
   * upload, so this should be unreachable — it is an ASSERTION, not a correction.
   * The caller logs it and SKIPS the move; it must never silently clamp.
   */
  violatesGeometry: boolean;
};

/**
 * The stop a position should be carrying, given how many rungs have filled.
 *
 * The single decision point: the executor never decides a stop level, it only
 * places what this returns. `rungsFilled` is a COUNT (see {@link nthNearestTp}).
 */
export function stopPlan(input: {
  snapshot: ProfileSnapshot;
  side: StopSide;
  /** COUNT of rungs FILLED — never a rung index. */
  rungsFilled: number;
  /** LEGACY `be` path only: has the `be`-th rung itself filled? */
  beRungFilled: boolean;
}): StopPlan {
  const s = input.snapshot;
  const tighten = ratchetPct(s);

  // ── LEGACY. No `sl_tighten_pct` ⇒ behave exactly as the engine does today:
  // one shot, to the entry, on the fill of the `be`-th RUNG (an index, not a count).
  if (tighten === null) {
    const armed = beRungIndex(s as unknown as ProfileConfig) !== null && input.beRungFilled;
    return armed
      ? { step: 1, distancePct: 0, rule: "BE", violatesGeometry: false }
      : { step: 0, distancePct: s.sl, rule: "FIXED", violatesGeometry: false };
  }

  const n = Math.max(0, Math.min(Math.trunc(input.rungsFilled), s.tp.length));
  if (n === 0) return { step: 0, distancePct: s.sl, rule: "FIXED", violatesGeometry: false };

  const linear = ratchetDistancePct(s.sl, tighten, n);
  const nearest = nthNearestTp(s.tp, n);
  const floor = nearest === null ? -Infinity : minDistancePct(nearest, stopBufferPct(s.takerFeePct, s.slippagePct), input.side);

  return {
    step: n,
    distancePct: linear, // NEVER clamped — a breach is a config bug, reported below.
    rule: "RATCHET",
    violatesGeometry: linear < floor,
  };
}

// ── Upload-time ladder preview (the tuning surface) ──────────────────────────

export type LadderRow = {
  /** Rungs filled. */
  n: number;
  /** Signed stop distance after n fills. */
  distancePct: number;
  /** The n-th nearest take-profit (null at n = 0). */
  tpNearestPct: number | null;
  /** G2 floor for each side — the tightest legal distance. */
  floorLong: number | null;
  floorShort: number | null;
  /** True when this row breaches G2 on either side. Such a config is REJECTED. */
  violatesG2: boolean;
  /** Stop is on the profit side. */
  profitLocked: boolean;
  /** Return on the position if it is stopped out here, % of notional, BEFORE fees. */
  pnlPct: number;
};

/**
 * Every step of the ladder, with the PnL you'd take if the stop fired there — the
 * table that turns `sl_tighten_pct` from a guess into a decision.
 *
 * Rows run n = 0 … tp.length−1. There is deliberately no row for the final rung:
 * the weights sum to 1, so the last take-profit closes the position outright and
 * no stop can ever matter at that point.
 *
 * `pnl(n) = Σ_{k≤n} w_k·tp_k − (1 − Σ_{k≤n} w_k)·d(n)`, over the n NEAREST rungs.
 */
export function ladderPreview(profile: ProfileConfig, takerFeePct: number, slippagePct: number): LadderRow[] {
  const tighten = ratchetPct(profile);
  if (tighten === null) return []; // legacy `be` config — no ladder to preview

  const buffer = stopBufferPct(takerFeePct, slippagePct);
  // Pair tp with its weight, then order by distance: this is the order price fills them.
  const byNearest = profile.tp
    .map((tp, i) => ({ tp, w: profile.w[i] ?? 0 }))
    .sort((a, b) => a.tp - b.tp);

  const rows: LadderRow[] = [];
  for (let n = 0; n <= profile.tp.length - 1; n++) {
    const d = ratchetDistancePct(profile.sl, tighten, n);
    const filled = byNearest.slice(0, n);
    const banked = filled.reduce((sum, r) => sum + r.w * r.tp, 0);
    const remainingW = 1 - filled.reduce((sum, r) => sum + r.w, 0);
    const nearest = n === 0 ? null : nthNearestTp(profile.tp, n);
    const floorLong = nearest === null ? null : minDistancePct(nearest, buffer, "LONG");
    const floorShort = nearest === null ? null : minDistancePct(nearest, buffer, "SHORT");

    rows.push({
      n,
      distancePct: d,
      tpNearestPct: nearest,
      floorLong,
      floorShort,
      violatesG2: (floorLong !== null && d < floorLong) || (floorShort !== null && d < floorShort),
      profitLocked: d < 0,
      // A stop is a loss when d > 0, so the remaining slice returns −d.
      pnlPct: banked - remainingW * d,
    });
  }
  return rows;
}
