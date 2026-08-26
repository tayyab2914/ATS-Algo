import { prisma } from "@/lib/db";
import type { MetricIconKey } from "@/lib/dashboard-data";
import { PERIOD_DAYS, type Period, periodColumn, periodStart, windowStart, type Timeframe } from "./window";

/**
 * The dashboard's numbers, computed from two genuinely different things:
 *
 *  - the **catalogue**: what each bot's backtest says (the `Bot` table, derived
 *    from the uploaded JSON + CSV), and
 *  - **live** results: what the execution engine has actually done (`Position`).
 *
 * Every metric therefore carries its `source`. A backtested 30-day return shown
 * under a "Daily" tab without that label would be a lie, and the backtest only
 * publishes 30/90/180/360-day columns — there is nothing daily or weekly in it.
 *
 * Live figures win whenever live data exists in the window; otherwise the
 * catalogue stands in, labelled as such.
 *
 * ── EVERY panel here is the signed-in member's own ──
 *
 * This screen sits above a personal portfolio and a personal My Bots table, so
 * every number on it answers "how are MY bots doing". Nothing aggregates other
 * members. An earlier version ran the Performance Metrics grid unscoped, which
 * summed every account on the platform into cards that read as personal — a
 * member with one idle deployment saw somebody else's win rate and trade count.
 *
 * The one thing that isn't member-scoped is the *backtest fallback*, and only
 * when the member has deployed nothing at all: with no bots of their own to
 * describe, the cards fall back to the published library so a fresh dashboard
 * isn't eight dashes. That set is labelled `source: "backtest"` and the section
 * header says so. Once they deploy anything, the fallback narrows to their bots.
 *
 * ── "active" means two different things, and conflating them is a lie ──
 *
 *   Bot.status === "ACTIVE"   the bot is PUBLISHED — visible in the library.
 *                             An admin toggle. Says nothing about trading.
 *   UserBot.active === true   the bot is RUNNING — a member deployed it and
 *                             switched it on. This is what "active bot" means
 *                             to a member looking at My Bots.
 *
 * "Active Bots" counts the second, for this member only. Counting the first told
 * members that 7 bots were active while not a single one was running.
 */

export type MetricSource = "live" | "backtest" | "none";

export type DashboardMetric = {
  id: string;
  label: string;
  icon: MetricIconKey;
  value: string;
  /** Secondary line under the value (a delta, a ratio, a caveat). */
  delta?: string;
  source: MetricSource;
  tone?: "success" | "danger";
};

export type TopBot = { id: string; name: string; pair: string; risk: string; returnPct: number };
export type MyBotRow = { id: string; name: string; profile: string; capital: number; pnl: number; active: boolean };
export type AllocationSlice = { id: string; label: string; color: string; capital: number; pct: number };
export type TopPerformer = { id: string; name: string; pnl: number; trades: number };

export type DashboardData = {
  /** Windows the LIVE member panels (My Bots PnL, portfolio delta). Calendar, UTC+2. */
  timeframe: Timeframe;
  /** Windows the Performance Metrics grid. Maps 1:1 onto the catalogue's d-columns. */
  period: Period;
  windowStart: Date;
  metrics: DashboardMetric[];
  topBots: TopBot[];
  myBots: MyBotRow[];
  portfolio: { balance: number; windowPnl: number; months: string[]; curve: number[]; allocation: AllocationSlice[] };
  topPerformers: TopPerformer[];
  /** True when at least one of THIS MEMBER's trades closed in the window. */
  hasLive: boolean;
  /** True once the member has deployed anything — also what narrows the backtest fallback. */
  hasDeployments: boolean;
  /** Bots this member has deployed AND switched on. What "active bot" means to them. */
  runningBots: number;
  /** Bots this member has deployed, running or not. */
  deployedBots: number;
  /** False when `topBots` had to fall back to the library because none of theirs are running. */
  topBotsAreRunning: boolean;
};

export const PALETTE = ["#28B8D5", "#5CC9DE", "#23E774", "#8A8F98", "#E8852B", "#D2031E", "#A855F7"];

const RISK_LABEL: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
const PROFILE_LABEL: Record<string, string> = { LOW: "Conservative", MEDIUM: "Balanced", HIGH: "Aggressive" };

const pct = (n: number) => `${n.toFixed(1)}%`;
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const signedMoney = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// ── Pure aggregation (unit-tested) ───────────────────────────────────────────

export type ClosedPosition = { realizedPnl: number; marginUsed: number };

export type LiveAggregate = {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  /** Mean return on the collateral actually committed, in percent. */
  avgReturnPct: number;
  realized: number;
};

export function aggregateLive(positions: ClosedPosition[]): LiveAggregate {
  const trades = positions.length;
  if (trades === 0) {
    return { trades: 0, wins: 0, losses: 0, winRate: 0, profitFactor: 0, avgReturnPct: 0, realized: 0 };
  }

  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let realized = 0;
  let returnSum = 0;
  let returnCount = 0;

  for (const position of positions) {
    realized += position.realizedPnl;
    if (position.realizedPnl > 0) {
      wins++;
      grossProfit += position.realizedPnl;
    } else {
      grossLoss += Math.abs(position.realizedPnl);
    }
    // A return needs the collateral it was earned on; a zero-margin row can't say.
    if (position.marginUsed > 0) {
      returnSum += (position.realizedPnl / position.marginUsed) * 100;
      returnCount++;
    }
  }

  return {
    trades,
    wins,
    losses: trades - wins,
    winRate: (wins / trades) * 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgReturnPct: returnCount > 0 ? returnSum / returnCount : 0,
    realized,
  };
}

export type CatalogueBot = {
  /** Identifies the bot behind the "Best Bot" tile. */
  name: string;
  /** Lifetime figures — they do not vary with a window. */
  trades: number;
  winRate: number;
  profitFactor: number;
  /** The only windowed figures the catalogue has. */
  d30: number;
  d90: number;
  d180: number;
  d360: number;
};

export type CatalogueColumn = "d30" | "d90" | "d180" | "d360";

export type CatalogueAggregate = {
  bots: number;
  totalTrades: number;
  /** Weighted by trade count — a 12-trade bot shouldn't sway the mean like a 900-trade one. */
  winRate: number;
  profitFactor: number;
  avgReturn: number;
  /**
   * The single best-returning bot over the selected window, or null for an empty
   * pool.
   *
   * This replaced "best timeframe". Members do not choose, see, or care about a
   * bot's candle interval — it is an implementation detail of the strategy — so
   * ranking by it told them nothing they could act on. The same "best of the pool
   * by the windowed column" idea, grouped by something they actually pick.
   */
  bestBot: { name: string; returnPct: number } | null;
};

/**
 * The two populations behind the word "active", kept apart on purpose.
 *
 * Returns what the "Active Bots" card must show. It exists as a named function so
 * the distinction is testable and can't quietly regress into counting the wrong
 * one — which once told members 7 bots were active while none were running.
 */
export function activeBotCount(runningBotIds: Iterable<string>): number {
  return new Set(runningBotIds).size;
}

export function aggregateCatalogue(bots: CatalogueBot[], column: CatalogueColumn): CatalogueAggregate {
  if (bots.length === 0) {
    return { bots: 0, totalTrades: 0, winRate: 0, profitFactor: 0, avgReturn: 0, bestBot: null };
  }

  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const winRate = totalTrades > 0 ? bots.reduce((sum, bot) => sum + bot.winRate * bot.trades, 0) / totalTrades : 0;

  // An infinite profit factor (a bot that never lost) would poison the mean.
  const finite = bots.filter((bot) => Number.isFinite(bot.profitFactor) && bot.profitFactor > 0);
  const profitFactor = finite.length ? finite.reduce((sum, bot) => sum + bot.profitFactor, 0) / finite.length : 0;

  const avgReturn = bots.reduce((sum, bot) => sum + bot[column], 0) / bots.length;

  // First past the post wins ties, which keeps the tile stable for a pool whose
  // order doesn't change between renders.
  let bestBot: CatalogueAggregate["bestBot"] = null;
  for (const bot of bots) {
    if (bestBot === null || bot[column] > bestBot.returnPct) {
      bestBot = { name: bot.name, returnPct: bot[column] };
    }
  }

  return { bots: bots.length, totalTrades, winRate, profitFactor, avgReturn, bestBot };
}

export type DatedPnl = { closedAt: Date; realizedPnl: number };

/**
 * Cumulative realized PnL bucketed into the last `months` calendar months,
 * oldest first. Trades older than the window are folded into the opening value so
 * the curve never restarts at zero for an account with history.
 */
export function monthlyCurve(positions: DatedPnl[], months = 8, now: Date = new Date()): { labels: string[]; curve: number[] } {
  const buckets: number[] = new Array(months).fill(0);
  const labels: string[] = [];
  const startYear = now.getUTCFullYear();
  const startMonth = now.getUTCMonth();

  for (let i = months - 1; i >= 0; i--) {
    const at = new Date(Date.UTC(startYear, startMonth - i, 1));
    labels.push(at.toLocaleString("en-US", { month: "short", timeZone: "UTC" }));
  }

  const firstBucketStart = Date.UTC(startYear, startMonth - (months - 1), 1);
  let carried = 0;
  for (const position of positions) {
    const at = position.closedAt.getTime();
    if (at < firstBucketStart) {
      carried += position.realizedPnl;
      continue;
    }
    const d = new Date(at);
    const index = (d.getUTCFullYear() - startYear) * 12 + (d.getUTCMonth() - startMonth) + (months - 1);
    if (index >= 0 && index < months) buckets[index] += position.realizedPnl;
  }

  let running = carried;
  const curve = buckets.map((delta) => (running += delta));
  return { labels, curve };
}

// ── Loading ──────────────────────────────────────────────────────────────────

export async function loadDashboard(
  userId: string | null,
  period: Period,
  timeframe: Timeframe,
  now: Date = new Date(),
): Promise<DashboardData> {
  // Two independent windows, because two different controls drive them.
  const periodFrom = periodStart(period, now);   // Performance Metrics (trailing)
  const start = windowStart(timeframe, now);     // member panels (calendar, UTC+2)
  const column = periodColumn(period);
  const periodDays = PERIOD_DAYS[period];

  const [libraryBots, deployments, closedInWindow, openPositions] = await Promise.all([
    // The library, PLUS anything this member runs that an admin has since
    // unpublished — their own bot must not drop out of their own numbers.
    prisma.bot.findMany({
      where: userId ? { OR: [{ status: "ACTIVE" }, { userBots: { some: { userId } } }] } : { status: "ACTIVE" },
      select: { id: true, name: true, ticker: true, riskClass: true, trades: true, winRate: true, profitFactor: true, d30: true, d90: true, d180: true, d360: true },
    }),
    // Every panel below hangs off these. One row per bot (UserBot is unique on
    // [userId, botId]), so a deployment count IS a bot count.
    userId
      ? prisma.userBot.findMany({
          where: { userId },
          select: {
            id: true,
            active: true,
            allocatedCapital: true,
            realizedBalance: true,
            bot: { select: { id: true, name: true, riskClass: true } },
            positions: { where: { status: "CLOSED" }, select: { realizedPnl: true, closedAt: true } },
          },
        })
      : Promise.resolve([]),
    // `Position.userId` is denormalized, so scoping costs no join.
    userId
      ? prisma.position.findMany({
          where: { userId, status: "CLOSED", closedAt: { gte: periodFrom } },
          select: { realizedPnl: true, marginUsed: true },
          take: 5000,
        })
      : Promise.resolve([]),
    userId ? prisma.position.count({ where: { userId, status: "OPEN" } }) : Promise.resolve(0),
  ]);

  const runningBotIds = new Set(deployments.filter((d) => d.active).map((d) => d.bot.id));
  const running = activeBotCount(runningBotIds);
  const deployedBotIds = new Set(deployments.map((d) => d.bot.id));
  const deployedBots = libraryBots.filter((bot) => deployedBotIds.has(bot.id));
  const hasDeployments = deployments.length > 0;

  const live = aggregateLive(closedInWindow);
  // Their bots' backtests once they have any; the library only for an empty
  // dashboard, where there is nothing of their own to describe.
  const catalogue = aggregateCatalogue(hasDeployments ? deployedBots : libraryBots, column);
  const hasLive = live.trades > 0;
  // Only the d-columns move with the period. Win rate, trade count and profit
  // factor are lifetime backtest figures and must never look windowed.
  const windowedNote = `${periodDays}d backtest`;
  const lifetimeNote = "lifetime backtest";

  const metrics: DashboardMetric[] = [
    {
      id: "active-bots",
      label: "Active Bots",
      icon: "bot",
      // Bots THIS MEMBER is running, not bots that are published and not the
      // platform's. A member checking this against My Bots must see the same number.
      value: String(running),
      delta: hasDeployments ? `of ${deployments.length} deployed` : "nothing deployed yet",
      source: "live",
      tone: running > 0 ? "success" : undefined,
    },
    {
      id: "win-rate",
      label: "Win Rate",
      icon: "target",
      value: hasLive ? pct(live.winRate) : catalogue.bots ? pct(catalogue.winRate) : "—",
      delta: hasLive ? `${live.wins}W / ${live.losses}L` : catalogue.bots ? lifetimeNote : undefined,
      source: hasLive ? "live" : catalogue.bots ? "backtest" : "none",
      tone: (hasLive ? live.winRate : catalogue.winRate) >= 50 ? "success" : "danger",
    },
    {
      id: "total-trades",
      label: "Total Trades",
      icon: "barChart",
      value: hasLive ? live.trades.toLocaleString("en-US") : catalogue.totalTrades.toLocaleString("en-US"),
      delta: hasLive ? `closed in ${periodDays}d` : catalogue.bots ? lifetimeNote : undefined,
      source: hasLive ? "live" : catalogue.bots ? "backtest" : "none",
    },
    {
      id: "avg-return",
      label: "Avg Return",
      icon: "percent",
      value: hasLive ? signedPct(live.avgReturnPct) : catalogue.bots ? signedPct(catalogue.avgReturn) : "—",
      delta: hasLive ? "per trade, on margin" : catalogue.bots ? windowedNote : undefined,
      source: hasLive ? "live" : catalogue.bots ? "backtest" : "none",
      tone: (hasLive ? live.avgReturnPct : catalogue.avgReturn) >= 0 ? "success" : "danger",
    },
    {
      id: "risk",
      label: "Risk Exposure",
      icon: "shield",
      value: hasLive ? `${live.wins} : ${live.losses}` : "—",
      delta: hasLive ? "wins : losses" : `no trades in ${periodDays}d`,
      source: hasLive ? "live" : "none",
      tone: hasLive && live.wins >= live.losses ? "success" : undefined,
    },
    {
      id: "open-positions",
      label: "Open Positions",
      icon: "layers",
      value: String(openPositions),
      delta: openPositions ? "held right now" : "flat",
      source: "live",
    },
    {
      id: "profit-factor",
      label: "Profit Factor",
      icon: "trendingUp",
      value: hasLive
        ? Number.isFinite(live.profitFactor)
          ? live.profitFactor.toFixed(2)
          : "∞"
        : catalogue.bots
          ? catalogue.profitFactor.toFixed(2)
          : "—",
      delta: hasLive ? `realized in ${periodDays}d` : catalogue.bots ? lifetimeNote : undefined,
      source: hasLive ? "live" : catalogue.bots ? "backtest" : "none",
      tone: (hasLive ? live.profitFactor : catalogue.profitFactor) >= 1 ? "success" : "danger",
    },
    {
      id: "best-bot",
      label: "Best Bot",
      icon: "activity",
      value: catalogue.bestBot ? signedPct(catalogue.bestBot.returnPct) : "—",
      delta: catalogue.bestBot ? `${catalogue.bestBot.name} · ${windowedNote}` : undefined,
      source: catalogue.bestBot ? "backtest" : "none",
      tone: catalogue.bestBot && catalogue.bestBot.returnPct >= 0 ? "success" : undefined,
    },
  ];

  // Rank the member's own running bots, then their idle ones, and only for a
  // member who has deployed nothing at all do we fall back to the published
  // library — where the page stops calling them active and says why.
  const runningBotRows = libraryBots.filter((bot) => runningBotIds.has(bot.id));
  const topBotsAreRunning = runningBotRows.length > 0;
  const rankPool = topBotsAreRunning ? runningBotRows : hasDeployments ? deployedBots : libraryBots;
  const topBots: TopBot[] = rankPool
    .slice()
    .sort((a, b) => b[column] - a[column])
    .slice(0, 3)
    .map((bot) => ({
      id: bot.id,
      name: bot.name,
      pair: bot.ticker ?? "—",
      risk: RISK_LABEL[bot.riskClass] ?? bot.riskClass,
      returnPct: bot[column],
    }));

  // ── The lower panels ───────────────────────────────────────────────────────
  const base: DashboardData = {
    timeframe,
    period,
    windowStart: start,
    metrics,
    topBots,
    myBots: [],
    portfolio: { balance: 0, windowPnl: 0, months: [], curve: [], allocation: [] },
    topPerformers: [],
    hasLive,
    hasDeployments,
    runningBots: running,
    deployedBots: deployments.length,
    topBotsAreRunning,
  };
  if (!hasDeployments) return base;

  const windowPnlFor = (positions: { realizedPnl: number; closedAt: Date | null }[]) =>
    positions.reduce((sum, p) => (p.closedAt && p.closedAt >= start ? sum + p.realizedPnl : sum), 0);

  const balance = deployments.reduce((sum, d) => sum + d.allocatedCapital + d.realizedBalance, 0);
  const totalCapital = deployments.reduce((sum, d) => sum + d.allocatedCapital, 0);

  const myBots: MyBotRow[] = deployments
    .map((d) => ({
      id: d.bot.id,
      name: d.bot.name,
      profile: PROFILE_LABEL[d.bot.riskClass] ?? d.bot.riskClass,
      capital: d.allocatedCapital,
      pnl: windowPnlFor(d.positions),
      active: d.active,
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.pnl - a.pnl)
    .slice(0, 3);

  const allocation: AllocationSlice[] = deployments
    .filter((d) => d.allocatedCapital > 0)
    .sort((a, b) => b.allocatedCapital - a.allocatedCapital)
    .slice(0, PALETTE.length)
    .map((d, i) => ({
      id: d.bot.id,
      label: d.bot.name,
      color: PALETTE[i],
      capital: d.allocatedCapital,
      pct: totalCapital > 0 ? (d.allocatedCapital / totalCapital) * 100 : 0,
    }));

  const allClosed = deployments.flatMap((d) =>
    d.positions.filter((p): p is { realizedPnl: number; closedAt: Date } => p.closedAt !== null),
  );
  const { labels, curve } = monthlyCurve(allClosed, 8, now);

  const topPerformers: TopPerformer[] = deployments
    .map((d) => ({
      id: d.bot.id,
      name: d.bot.name,
      pnl: d.positions.reduce((sum, p) => sum + p.realizedPnl, 0),
      trades: d.positions.length,
    }))
    .filter((row) => row.trades > 0)
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 5);

  return {
    ...base,
    myBots,
    portfolio: { balance, windowPnl: windowPnlFor(allClosed), months: labels, curve, allocation },
    topPerformers,
  };
}

export const format = { pct, signedPct, money, signedMoney };
