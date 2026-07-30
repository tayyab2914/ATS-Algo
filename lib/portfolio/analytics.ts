import { prisma } from "@/lib/db";
import { windowStart } from "@/lib/dashboard/window";
import { computeDailyPnl, type DayPnl } from "@/lib/portfolio/calendar";

/**
 * Portfolio analytics — every number on the Portfolio page, computed from the
 * member's own CLOSED positions. Nothing here is invented: an account that has
 * not traded reads as zeros and empty charts, and the figures become real the
 * moment the execution engine books a fill.
 *
 * The math lives in exported pure functions so it can be tested against
 * synthetic trades without a database; {@link loadPortfolioAnalytics} is the only
 * part that touches Prisma.
 */

/** One closed trade, reduced to the fields every metric needs. */
export type ClosedTrade = {
  side: "LONG" | "SHORT";
  realizedPnl: number;
  /** Collateral committed — the denominator for per-trade return %. */
  marginUsed: number;
  /** Contracts × entry price = notional, for volume. */
  size: number;
  entryPrice: number;
  openedAt: Date;
  closedAt: Date;
};

/** A position with only the timestamps/side needed for the time-bucketed charts. */
export type TradeForBucket = {
  realizedPnl: number;
  marginUsed: number;
  openedAt: Date;
  closedAt: Date | null;
  status: "OPEN" | "CLOSED";
};

/** The full set of metrics for one window (a table column). */
export type MetricSet = {
  hasData: boolean;
  /** Mean per-trade return on margin, %. */
  avgPlPct: number;
  /** Total realized PnL in quote currency. */
  plUsd: number;
  /** Total realized PnL over total margin, %. */
  plPct: number;
  /** Realized PnL over standing allocated capital, %. */
  roiPct: number;
  /** Worst and best single-trade return on margin, %. */
  maxLossPct: number;
  maxGainPct: number;
  /** Traded notional (Σ size × entry price). */
  volume: number;
  tradesTotal: number;
  tradesWins: number;
  tradesLosses: number;
  /** Mean holding time, milliseconds. */
  avgTimeInTradeMs: number;
  /** Gross profit ÷ gross loss. `null` means "all wins / no losing trades". */
  profitFactor: number | null;
  /** Realized PnL over volume, %. */
  profitOverVolumePct: number;
  /** Winning trades ÷ trades, %. */
  percentProfitable: number;
};

export const EMPTY_METRICS: MetricSet = {
  hasData: false,
  avgPlPct: 0,
  plUsd: 0,
  plPct: 0,
  roiPct: 0,
  maxLossPct: 0,
  maxGainPct: 0,
  volume: 0,
  tradesTotal: 0,
  tradesWins: 0,
  tradesLosses: 0,
  avgTimeInTradeMs: 0,
  profitFactor: 0,
  profitOverVolumePct: 0,
  percentProfitable: 0,
};

const sum = (xs: number[]): number => xs.reduce((total, x) => total + x, 0);
const tradeReturnPct = (t: ClosedTrade): number => (t.marginUsed > 0 ? (t.realizedPnl / t.marginUsed) * 100 : 0);

/**
 * Every table metric for a set of closed trades. `allocatedCapital` is the
 * standing capital base for ROI; the trades themselves carry margin and notional.
 */
export function computeMetrics(trades: ClosedTrade[], allocatedCapital: number): MetricSet {
  if (trades.length === 0) return { ...EMPTY_METRICS };

  const pnls = trades.map((t) => t.realizedPnl);
  const margins = trades.map((t) => t.marginUsed);
  const returnsPct = trades.filter((t) => t.marginUsed > 0).map(tradeReturnPct);

  const plUsd = sum(pnls);
  const totalMargin = sum(margins);
  const volume = sum(trades.map((t) => t.size * t.entryPrice));
  const wins = trades.filter((t) => t.realizedPnl > 0).length;
  const losses = trades.filter((t) => t.realizedPnl < 0).length;

  const grossProfit = sum(pnls.filter((p) => p > 0));
  const grossLoss = Math.abs(sum(pnls.filter((p) => p < 0)));
  // null = no losing trades to divide by (an unbeaten record), rendered as "∞".
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;

  const holdMs = trades.map((t) => Math.max(0, t.closedAt.getTime() - t.openedAt.getTime()));

  return {
    hasData: true,
    avgPlPct: returnsPct.length ? sum(returnsPct) / returnsPct.length : 0,
    plUsd,
    plPct: totalMargin > 0 ? (plUsd / totalMargin) * 100 : 0,
    roiPct: allocatedCapital > 0 ? (plUsd / allocatedCapital) * 100 : 0,
    maxLossPct: returnsPct.length ? Math.min(...returnsPct) : 0,
    maxGainPct: returnsPct.length ? Math.max(...returnsPct) : 0,
    volume,
    tradesTotal: trades.length,
    tradesWins: wins,
    tradesLosses: losses,
    avgTimeInTradeMs: holdMs.length ? sum(holdMs) / holdMs.length : 0,
    profitFactor,
    profitOverVolumePct: volume > 0 ? (plUsd / volume) * 100 : 0,
    percentProfitable: trades.length ? (wins / trades.length) * 100 : 0,
  };
}

/** The Trading Analysis block — all-time, split by direction. */
export type TradingAnalysis = {
  volume: number;
  closedOrders: number;
  winningClosed: number;
  winRate: number;
  pnlLong: number;
  pnlShort: number;
};

export function computeAnalysis(trades: ClosedTrade[]): TradingAnalysis {
  const wins = trades.filter((t) => t.realizedPnl > 0).length;
  return {
    volume: sum(trades.map((t) => t.size * t.entryPrice)),
    closedOrders: trades.length,
    winningClosed: wins,
    winRate: trades.length ? (wins / trades.length) * 100 : 0,
    pnlLong: sum(trades.filter((t) => t.side === "LONG").map((t) => t.realizedPnl)),
    pnlShort: sum(trades.filter((t) => t.side === "SHORT").map((t) => t.realizedPnl)),
  };
}

// ── Time-bucketed series for the Stats charts ────────────────────────────────

export type StatWindow = "week" | "month" | "all";
export const STAT_WINDOWS: StatWindow[] = ["week", "month", "all"];
export const STAT_WINDOW_LABEL: Record<StatWindow, string> = { week: "Week", month: "Month", all: "All Time" };
export const isStatWindow = (v: unknown): v is StatWindow =>
  typeof v === "string" && (STAT_WINDOWS as string[]).includes(v);
export const parseStatWindow = (v: unknown): StatWindow => (isStatWindow(v) ? v : "month");

const DAY_MS = 86_400_000;
const OFFSET_MS = 120 * 60_000; // UTC+2, matching lib/dashboard/window.ts

/** Short month label for a bucket start, on the UTC+2 clock. */
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Bucket = { start: number; end: number; label: string };

/** Build `count` consecutive week/month buckets ending in the one containing `now`. */
function buildBuckets(unit: "week" | "month", count: number, now: Date): Bucket[] {
  const buckets: Bucket[] = [];
  if (unit === "week") {
    const thisWeek = windowStart("weekly", now).getTime();
    for (let i = count - 1; i >= 0; i--) {
      const start = thisWeek - i * 7 * DAY_MS;
      const local = new Date(start + OFFSET_MS);
      buckets.push({ start, end: start + 7 * DAY_MS, label: `${local.getUTCDate()} ${MONTH_LABELS[local.getUTCMonth()]}` });
    }
    return buckets;
  }
  const base = new Date(now.getTime() + OFFSET_MS);
  let year = base.getUTCFullYear();
  let month = base.getUTCMonth();
  const starts: number[] = [];
  for (let i = 0; i < count; i++) {
    starts.unshift(Date.UTC(year, month, 1) - OFFSET_MS);
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  for (const start of starts) {
    const local = new Date(start + OFFSET_MS);
    const next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - OFFSET_MS;
    buckets.push({ start, end: next, label: MONTH_LABELS[local.getUTCMonth()] });
  }
  return buckets;
}

export type StatSeries = {
  window: StatWindow;
  labels: string[];
  /** Per-bucket realized PnL over margin, %. */
  plPct: number[];
  /** Running cumulative of `plPct`. */
  cumulativePct: number[];
  /** Positions open at any time during the bucket. */
  openCounts: number[];
  hasData: boolean;
};

/**
 * The three Stats charts as parallel arrays. `all` shows up to 12 months since
 * the first trade; `week`/`month` show the trailing 8 buckets.
 */
export function computeStatSeries(positions: TradeForBucket[], window: StatWindow, now: Date): StatSeries {
  let unit: "week" | "month";
  let count: number;
  if (window === "week") {
    unit = "week";
    count = 8;
  } else if (window === "all") {
    unit = "month";
    const earliest = positions.reduce<number | null>((min, p) => {
      const t = p.openedAt.getTime();
      return min === null || t < min ? t : min;
    }, null);
    if (earliest === null) {
      count = 8;
    } else {
      const monthsSpan =
        (now.getUTCFullYear() - new Date(earliest).getUTCFullYear()) * 12 +
        (now.getUTCMonth() - new Date(earliest).getUTCMonth()) +
        1;
      count = Math.min(12, Math.max(8, monthsSpan));
    }
  } else {
    unit = "month";
    count = 8;
  }

  const buckets = buildBuckets(unit, count, now);
  const closed = positions.filter((p) => p.status === "CLOSED" && p.closedAt);

  const plPct: number[] = [];
  const openCounts: number[] = [];
  for (const b of buckets) {
    const inBucket = closed.filter((p) => {
      const c = p.closedAt!.getTime();
      return c >= b.start && c < b.end;
    });
    const margin = sum(inBucket.map((p) => p.marginUsed));
    const pnl = sum(inBucket.map((p) => p.realizedPnl));
    plPct.push(margin > 0 ? (pnl / margin) * 100 : 0);
    // Open at any time during the bucket: opened before it ended and not yet
    // closed by the time it began.
    openCounts.push(
      positions.filter(
        (p) => p.openedAt.getTime() < b.end && (p.closedAt === null || p.closedAt.getTime() >= b.start),
      ).length,
    );
  }

  const cumulativePct: number[] = [];
  let running = 0;
  for (const v of plPct) {
    running += v;
    cumulativePct.push(running);
  }

  return {
    window,
    labels: buckets.map((b) => b.label),
    plPct,
    cumulativePct,
    openCounts,
    hasData: closed.length > 0,
  };
}

/** Cumulative realized PnL ($) per month — the standalone Cumulative PnL chart. */
export function computeMonthlyPnl(positions: TradeForBucket[], months: number, now: Date): { labels: string[]; curve: number[] } {
  const buckets = buildBuckets("month", months, now);
  const closed = positions.filter((p) => p.status === "CLOSED" && p.closedAt);
  // Cumulative realized PnL to the END of each bucket, so history before the
  // window is carried into the opening value instead of restarting at zero.
  const curve = buckets.map((b) => sum(closed.filter((p) => p.closedAt!.getTime() < b.end).map((p) => p.realizedPnl)));
  return { labels: buckets.map((b) => b.label), curve };
}

// ── DB loader ────────────────────────────────────────────────────────────────

export type PortfolioAnalytics = {
  /** Does the member have any deployed bots at all? Drives the empty-state CTA. */
  hasBots: boolean;
  /** Has the engine ever closed a trade for them? Drives every "no data yet" note. */
  hasTrades: boolean;
  /** The exchange their bots trade on, for the connection indicator. */
  exchange: string | null;
  allTime: MetricSet;
  month: MetricSet;
  week: MetricSet;
  analysis: TradingAnalysis;
  stats: StatSeries;
  monthlyEquity: { labels: string[]; totalPnlPct: number[] };
  cumulativePnl: { labels: string[]; curve: number[] };
  /**
   * Realized PnL per calendar day, for the PnL calendar. Only days that actually
   * closed a trade are present, so this is proportional to activity rather than to
   * the age of the account — a year of daily trading is a couple of hundred rows,
   * which is why the whole history ships at once and the calendar pages instantly.
   */
  dailyPnl: DayPnl[];
};

/**
 * Load every Portfolio figure for one member. `statsWindow` only scopes the
 * three Stats charts; the metric table always shows all three windows at once.
 */
export async function loadPortfolioAnalytics(
  userId: string,
  statsWindow: StatWindow = "month",
  now: Date = new Date(),
): Promise<PortfolioAnalytics> {
  const [deployments, connection] = await Promise.all([
    prisma.userBot.findMany({
      where: { userId },
      select: {
        allocatedCapital: true,
        exchangeSource: true,
        positions: {
          select: {
            side: true,
            status: true,
            realizedPnl: true,
            marginUsed: true,
            size: true,
            entryPrice: true,
            createdAt: true,
            closedAt: true,
          },
        },
      },
    }),
    prisma.exchangeConnection.findFirst({ where: { userId }, select: { exchange: true } }),
  ]);

  const allocatedCapital = sum(deployments.map((d) => d.allocatedCapital));
  const positions = deployments.flatMap((d) => d.positions);

  const forBucket: TradeForBucket[] = positions.map((p) => ({
    realizedPnl: p.realizedPnl,
    marginUsed: p.marginUsed,
    openedAt: p.createdAt,
    closedAt: p.closedAt,
    status: p.status as "OPEN" | "CLOSED",
  }));

  const closedAll: ClosedTrade[] = positions
    .filter((p) => p.status === "CLOSED" && p.closedAt)
    .map((p) => ({
      side: p.side as "LONG" | "SHORT",
      realizedPnl: p.realizedPnl,
      marginUsed: p.marginUsed,
      size: p.size,
      entryPrice: p.entryPrice,
      openedAt: p.createdAt,
      closedAt: p.closedAt!,
    }));

  const since = (from: Date) => closedAll.filter((t) => t.closedAt.getTime() >= from.getTime());
  const monthTrades = since(windowStart("monthly", now));
  const weekTrades = since(windowStart("weekly", now));

  const stats = computeStatSeries(forBucket, statsWindow, now);

  return {
    hasBots: deployments.length > 0,
    hasTrades: closedAll.length > 0,
    exchange: deployments.find((d) => d.exchangeSource)?.exchangeSource ?? connection?.exchange ?? null,
    allTime: computeMetrics(closedAll, allocatedCapital),
    month: computeMetrics(monthTrades, allocatedCapital),
    week: computeMetrics(weekTrades, allocatedCapital),
    analysis: computeAnalysis(closedAll),
    stats,
    // Monthly Equity: the real Total-PnL% line. The BTC benchmark the Figma shows
    // needs historical BTC prices we don't store, so it's left for a later slot
    // rather than faked.
    monthlyEquity: { labels: stats.labels, totalPnlPct: stats.cumulativePct },
    cumulativePnl: computeMonthlyPnl(forBucket, 8, now),
    dailyPnl: computeDailyPnl(closedAll.map((t) => ({ realizedPnl: t.realizedPnl, marginUsed: t.marginUsed, closedAt: t.closedAt }))),
  };
}
