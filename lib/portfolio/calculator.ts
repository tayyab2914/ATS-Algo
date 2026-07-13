/**
 * Leverage / PnL calculator. Pure arithmetic, no I/O — the same numbers a member
 * would get from leverage.trading, computed here so they never leave the app.
 *
 * All prices are quote currency, `quantity` is base units (contracts), and every
 * rate is a percentage (0.06 means 0.06%, not 6%).
 */

export type Side = "long" | "short";

export type CalculatorInput = {
  side: Side;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
  /** Taker fee charged on entry and on exit, in percent. Bitget's default is 0.06. */
  feePct: number;
  /** Maintenance margin rate, in percent. Drives the liquidation estimate. */
  maintenanceMarginPct: number;
};

export type CalculatorResult = {
  /** Position value at entry. */
  notional: number;
  /** Collateral the position requires. */
  margin: number;
  /** Price movement only, before costs. */
  grossPnl: number;
  fees: number;
  netPnl: number;
  /** Return on the collateral committed, in percent — what leverage magnifies. */
  roi: number;
  /** Return on the position's value, in percent — what price actually did. */
  priceMove: number;
  liquidationPrice: number;
  /** How far price can move against the position before liquidation, in percent. */
  distanceToLiquidation: number;
};

export const DEFAULTS = { feePct: 0.06, maintenanceMarginPct: 0.5 };

/**
 * Liquidation estimate for an isolated position.
 *
 * A long is liquidated once losses eat the margin down to the maintenance
 * requirement: `entry × (1 − 1/leverage + mmr)`. It is an estimate — funding,
 * fees and a venue's tiered maintenance table all move the real level, and
 * cross-margin shares collateral across positions entirely.
 */
export function liquidationPrice(side: Side, entryPrice: number, leverage: number, maintenanceMarginPct: number): number {
  if (!(entryPrice > 0) || !(leverage >= 1)) return 0;
  const mmr = maintenanceMarginPct / 100;
  const factor = 1 / leverage - mmr;
  const price = side === "long" ? entryPrice * (1 - factor) : entryPrice * (1 + factor);
  return Math.max(price, 0);
}

export function calculate(input: CalculatorInput): CalculatorResult {
  const { side, entryPrice, exitPrice, quantity, leverage, feePct, maintenanceMarginPct } = input;

  const notional = entryPrice * quantity;
  const margin = leverage > 0 ? notional / leverage : 0;

  const grossPnl = side === "long" ? (exitPrice - entryPrice) * quantity : (entryPrice - exitPrice) * quantity;
  // Charged on the value of each side of the round trip, not just the entry.
  const fees = (notional * feePct) / 100 + (exitPrice * quantity * feePct) / 100;
  const netPnl = grossPnl - fees;

  const liq = liquidationPrice(side, entryPrice, leverage, maintenanceMarginPct);

  return {
    notional,
    margin,
    grossPnl,
    fees,
    netPnl,
    roi: margin > 0 ? (netPnl / margin) * 100 : 0,
    priceMove: entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 * (side === "long" ? 1 : -1) : 0,
    liquidationPrice: liq,
    distanceToLiquidation: entryPrice > 0 ? (Math.abs(entryPrice - liq) / entryPrice) * 100 : 0,
  };
}

/**
 * How many units to buy so that being stopped out costs exactly `riskPct` of the
 * account. The answer depends on the stop distance, never on the leverage —
 * leverage only decides how much collateral the same position ties up.
 */
export function positionSizeForRisk(accountBalance: number, riskPct: number, entryPrice: number, stopPrice: number): number {
  const riskAmount = (accountBalance * riskPct) / 100;
  const stopDistance = Math.abs(entryPrice - stopPrice);
  if (!(stopDistance > 0) || !(riskAmount > 0)) return 0;
  return riskAmount / stopDistance;
}
