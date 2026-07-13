/**
 * Pure price and size math for LIVE order placement.
 *
 * No exchange calls, no I/O, and deliberately **no import from lib/backtest** —
 * backtesting happens in TradingView's Strategy Tester, never on the order path.
 * Everything here is a plain function so it can be unit-checked without a key.
 */
export type Side = "LONG" | "SHORT";

/** Stop price: below entry for a long, above it for a short. */
export const slPrice = (entry: number, slPct: number, side: Side): number =>
  side === "LONG" ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);

/** Price of one take-profit rung, `tpPct` away from entry in the winning direction. */
export const tpPrice = (entry: number, tpPct: number, side: Side): number =>
  side === "LONG" ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);

/** Contracts controlled by `margin` of collateral at `lev` leverage. */
export const sizeFromMargin = (margin: number, lev: number, price: number): number =>
  (margin * lev) / price;

/** The reduce-only order side that closes a position. */
export const closingSide = (side: Side): "buy" | "sell" => (side === "LONG" ? "sell" : "buy");

export type SizingInput = {
  allocationType: "FIXED" | "PERCENTAGE";
  /** Dollar amount when FIXED, percent of the base when PERCENTAGE. */
  capitalPerTrade: number;
  allocatedCapital: number;
  /** Running sum of realized PnL for this deployment; only used when compounding. */
  realizedBalance: number;
  compounding: boolean;
};

/**
 * Collateral committed to one trade. When `compounding`, the deployment's
 * realized PnL grows (or shrinks) the base it sizes from. The base is floored at
 * zero so a deeply negative `realizedBalance` can never invert the sign.
 */
export function tradeMargin(input: SizingInput): number {
  const base = input.compounding
    ? Math.max(input.allocatedCapital + input.realizedBalance, 0)
    : input.allocatedCapital;
  return input.allocationType === "PERCENTAGE" ? (input.capitalPerTrade / 100) * base : input.capitalPerTrade;
}

/**
 * Split `size` contracts across the take-profit ladder by weight, rounding each
 * rung to the exchange's amount precision via `round`.
 *
 * The final rung absorbs rounding drift, but only up to the ladder's *intended*
 * total (`size * Σw`). When `Σw < 1` the shortfall is deliberate — that residue
 * rides the position until the stop or an exit signal closes it — so the last
 * rung must not swell to consume it.
 */
export function rungSizes(size: number, w: number[], round: (n: number) => number): number[] {
  if (w.length === 0) return [];
  const totalWeight = Math.min(
    w.reduce((sum, x) => sum + x, 0),
    1,
  );
  const intended = round(size * totalWeight);

  const out: number[] = [];
  let used = 0;
  for (let k = 0; k < w.length - 1; k++) {
    const rung = round(size * w[k]);
    out.push(rung);
    used += rung;
  }
  // Nudge by a relative epsilon before rounding: binary subtraction leaves noise
  // (0.014 - 0.0107 === 0.0032999999999999995) that a truncating `round` would
  // turn into a whole lost precision step on the final rung. The nudge is orders
  // of magnitude smaller than any real precision step, so it can only recover a
  // value that was already at the boundary.
  const remainder = (intended - used) * (1 + 1e-12);
  out.push(Math.max(round(remainder), 0));
  return out;
}
