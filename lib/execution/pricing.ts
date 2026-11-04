/**
 * Pure price and size math for LIVE order placement.
 *
 * No exchange calls, no I/O, and deliberately **no import from lib/backtest** —
 * backtesting happens in TradingView's Strategy Tester, never on the order path.
 * Everything here is a plain function so it can be unit-checked without a key.
 *
 * The ccxt and bot-config imports are TYPE-ONLY, which is what keeps that true: this module
 * stays importable from a client component and from a plain `tsx` script with no
 * `--conditions=react-server`.
 */
import type { MarketInterface } from "ccxt";
import type { ProfileConfig } from "@/lib/bot-config";

export type Side = "LONG" | "SHORT";

/** Stop price: below entry for a long, above it for a short. */
export const slPrice = (entry: number, slPct: number, side: Side): number =>
  side === "LONG" ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);

/** Price of one take-profit rung, `tpPct` away from entry in the winning direction. */
export const tpPrice = (entry: number, tpPct: number, side: Side): number =>
  side === "LONG" ? entry * (1 + tpPct / 100) : entry * (1 - tpPct / 100);

/**
 * Order size, in the units the VENUE counts, for `margin` of collateral at `lev` leverage.
 *
 * `contractSize` is the base amount ONE contract represents, straight off the ccxt market
 * descriptor. It defaults to 1 because that is what Bitget and Bybit report for a linear perp —
 * there, one "contract" IS one BTC, so base units and venue units coincide and this divisor
 * vanishes.
 *
 * BloFin is the reason the parameter exists: it denominates in genuine contracts, and the size
 * differs PER INSTRUMENT (BTC-USDT 0.001, ETH-USDT 0.01, SOL-USDT 1). Passing base units there
 * would ask for a thousandth of the intended position on BTC. It happens to fail loudly rather
 * than silently — the result lands under the venue's minimum and is rejected — but only by luck
 * of the numbers, so the conversion belongs here rather than in a caller's head.
 *
 * Everything downstream (`rungSizes`, the minimum-amount checks, what goes on the wire) then
 * works in one consistent unit: venue units. Only NOTIONAL needs converting back, which is why
 * the cost checks multiply by `contractSize` again.
 */
export const sizeFromMargin = (margin: number, lev: number, price: number, contractSize = 1): number =>
  (margin * lev) / price / (contractSize || 1);

/** What `size` venue-units is worth in quote currency — the number a minimum-notional guards. */
export const notionalOf = (size: number, price: number, contractSize = 1): number =>
  size * (contractSize || 1) * price;

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

// ── Take-profit ladder ───────────────────────────────────────────────────────
//
// Pure, and here rather than in execute.ts on purpose: the floor these compute is shown to
// members on the settings screen and gates activation, so it must be reachable without
// dragging the order engine (and Prisma, and the venue clients) into a page render.
//
// `round` / `roundPrice` are the venue's OWN `amountToPrecision` / `priceToPrecision`,
// passed in rather than imported — these stay free of ccxt at runtime, and the rounding
// that matters is the one the exchange will actually apply.

export type LadderRung = { rungIndex: number; size: number; price: number };

/**
 * The venue's amount INCREMENT, or null when it cannot be trusted.
 *
 * `market.precision.amount` is a step only under ccxt's TICK_SIZE counting mode — which all
 * four venues here use. Under DECIMAL_PLACES the same field is a digit COUNT, and reading a
 * `3` as a step of 3 BTC would put an absurd number in front of a member. So it is verified
 * against the venue's own rounding before being trusted: a genuine step `s` always truncates
 * `2.5s` down to exactly `2s`.
 */
function amountStep(market: MarketInterface, round: (n: number) => number): number | null {
  const step = Number(market.precision?.amount ?? 0);
  if (!(step > 0) || !Number.isFinite(step)) return null;
  return Math.abs(round(step * 2.5) - step * 2) <= step * 1e-6 ? step : null;
}

/**
 * `steps` whole increments, expressed through the venue's own rounding.
 *
 * Aims at the MIDDLE of the target step so the truncating `round` lands exactly on it, free of
 * the float dust `steps * step` carries (13 * 0.001 is 0.013000000000000001).
 */
const atStep = (steps: number, step: number, round: (n: number) => number): number =>
  round(steps * step + step / 2);

/** How far above the arithmetic floor a viable size is searched for. Pure math, so generous. */
const MAX_FLOOR_STEPS = 64;

/**
 * The ladder for `size`, exactly as it would be sent — or null when any rung falls under the
 * venue's per-order floors.
 *
 * Checked TWICE, deliberately. The unrounded shares come first because `amountToPrecision`
 * throws for anything below one precision step, so rounding ahead of the check would raise a
 * ccxt error instead of our actionable one. The ROUNDED orders are then checked again because
 * the final rung absorbs the remainder and can land under the minimum even when its unrounded
 * share cleared it.
 */
function buildLadder(
  entryPrice: number,
  size: number,
  profile: ProfileConfig,
  side: Side,
  market: MarketInterface,
  round: (n: number) => number,
  roundPrice: (n: number) => number,
): LadderRung[] | null {
  const minAmount = Number(market.limits?.amount?.min ?? 0);
  const minCost = Number(market.limits?.cost?.min ?? 0);
  // `size` and every rung are in VENUE units. On a contract-denominated venue those are not base
  // units, so notional needs converting back before it can be compared to a minimum COST.
  const contractSize = Number(market.contractSize ?? 1) || 1;

  for (let k = 0; k < profile.w.length; k++) {
    const raw = size * profile.w[k];
    const price = tpPrice(entryPrice, profile.tp[k], side);
    if (raw < minAmount || (minCost > 0 && notionalOf(raw, price, contractSize) < minCost)) return null;
  }

  const rungs: LadderRung[] = rungSizes(size, profile.w, round).map((rungSize, rungIndex) => ({
    rungIndex,
    size: rungSize,
    price: roundPrice(tpPrice(entryPrice, profile.tp[rungIndex], side)),
  }));

  for (const rung of rungs) {
    if (rung.size < minAmount || (minCost > 0 && notionalOf(rung.size, rung.price, contractSize) < minCost)) return null;
  }
  return rungs;
}

/**
 * The smallest position that can actually place every rung — the number a member has to be
 * able to fund.
 *
 * NOT simply `minAmount / min(w)`. Every size this engine sends is TRUNCATED to the venue's
 * amount step, so a requirement landing between two steps is unreachable and the next step up
 * is the real floor. Quoting the untruncated figure is the bug this exists to kill: a member
 * on $140 was told the trade needed ~964 USDT of notional, funded exactly that, and was
 * rejected again — because 0.0125 BTC rounds DOWN to 0.012, whose smallest rung is 0.00096
 * against a 0.001 minimum.
 *
 * So the arithmetic floor is only a starting point: it is rounded up to the step and then
 * VERIFIED by building the ladder, stepping up until one fits. The verify earns its keep
 * because rounding each rung down can starve the final rung, which the arithmetic does not
 * model at all.
 *
 * `side` matters: a SHORT prices its rungs BELOW entry, so they clear a minimum NOTIONAL less
 * easily than a long's. Quote a floor for the side being traded — or for "SHORT" when the
 * answer has to hold for either.
 *
 * Returns null when nothing within {@link MAX_FLOOR_STEPS} works, which leaves the caller with
 * no number to quote. That is honest; a number that would fail again is not.
 */
export function ladderFloorSize(
  entryPrice: number,
  profile: ProfileConfig,
  side: Side,
  market: MarketInterface,
  round: (n: number) => number,
  roundPrice: (n: number) => number,
): number | null {
  const minAmount = Number(market.limits?.amount?.min ?? 0);
  const minCost = Number(market.limits?.cost?.min ?? 0);
  const contractSize = Number(market.contractSize ?? 1) || 1;
  if (profile.w.length === 0 || !(entryPrice > 0)) return null;

  const arithmetic = Math.max(
    ...profile.w.map((weight) =>
      Math.max(minAmount / weight, minCost > 0 ? minCost / (weight * contractSize * entryPrice) : 0),
    ),
  );
  if (!Number.isFinite(arithmetic) || arithmetic <= 0) return null;

  const fits = (candidate: number) =>
    candidate > 0 && buildLadder(entryPrice, candidate, profile, side, market, round, roundPrice) !== null;

  const step = amountStep(market, round);
  // No trustworthy step: the arithmetic figure is all there is, and it is still worth
  // verifying rather than quoting on faith.
  if (step === null) return fits(arithmetic) ? arithmetic : null;

  // Nudge before the ceiling: 0.01 / 0.001 is 10.000000000000002 in binary, and a bare ceil
  // would push a value already ON a step up to the next one.
  let steps = Math.ceil(arithmetic / step - 1e-9);
  for (let i = 0; i < MAX_FLOOR_STEPS; i++, steps++) {
    const candidate = atStep(steps, step, round);
    if (fits(candidate)) return candidate;
  }
  return null;
}

/**
 * Split the position across the ladder and price each rung off the real entry.
 *
 * Every rung is an independent order, so each must clear the venue's minimum
 * amount *and* minimum notional on its own — a 6-rung ladder whose smallest
 * weight is 0.08 needs a position ~12.5x the minimum order size. Checked before
 * the entry is sent: discovering it afterwards would leave a leveraged position
 * open with no take-profits at all.
 */
export function planLadder(entryPrice: number, size: number, profile: ProfileConfig, side: Side, market: MarketInterface, round: (n: number) => number, roundPrice: (n: number) => number): LadderRung[] {
  const rungs = buildLadder(entryPrice, size, profile, side, market, round, roundPrice);
  if (rungs) return rungs;

  // Rejected — so quote the size that would actually work, not the one the arithmetic alone
  // suggests. See ladderFloorSize for why those are not the same number.
  const floor = ladderFloorSize(entryPrice, profile, side, market, round, roundPrice);
  if (floor === null) throw new Error("LADDER_UNPLACEABLE");
  const contractSize = Number(market.contractSize ?? 1) || 1;
  // Cents rounded UP, not to-nearest. `toFixed(2)` on 1002.8512 gives 1002.85 — a hair UNDER
  // the floor, and funding exactly that lands back on 0.012 and is rejected all over again.
  // Same trap as the size itself, one decimal place down.
  const notional = Math.ceil(notionalOf(floor, entryPrice, contractSize) * 100) / 100;
  throw new Error(`LADDER_TOO_SMALL:${floor.toPrecision(4)}:${notional.toFixed(2)}`);
}
