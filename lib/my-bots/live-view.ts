import type { ProfileConfig } from "@/lib/bot-config";
import { profileFor, type BotConfig, type RiskClass } from "@/lib/bot-config";
import { prisma } from "@/lib/db";

/**
 * What a member's deployment is actually doing, assembled from the positions and
 * orders the engine really placed. Nothing here is illustrative: if there are no
 * trades yet the page says so, rather than showing numbers from a demo fixture.
 */

export type LadderRungView = {
  rungIndex: number;
  price: number;
  size: number;
  filled: boolean;
};

export type OpenPositionView = {
  symbol: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  stopPrice: number;
  beMoved: boolean;
  rungsFilled: number;
  rungsTotal: number;
  sandbox: boolean;
  openedAt: Date;
  rungs: LadderRungView[];
  /** Live-mark snapshot from the last sync — null until the first pass after open. */
  markPrice: number | null;
  unrealizedPnl: number | null;
  markedAt: Date | null;
};

export type PerformanceView = {
  trades: number;
  wins: number;
  winRate: number;
  realizedPnl: number;
  avgTrade: number;
  /** Deepest peak-to-trough of cumulative realized PnL, in quote currency. */
  maxDrawdown: number;
  /** Mean time from entry to close, in minutes. */
  avgDurationMin: number;
  /** Cumulative realized PnL after each closed trade, oldest first. */
  equity: number[];
};

export type TimelineEvent = {
  id: string;
  title: string;
  at: Date;
  level: "info" | "warn" | "error";
};

/** One closed trade, as a member sees it in the history table. */
export type ClosedTradeView = {
  id: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entryPrice: number;
  realizedPnl: number;
  /** Position.closedReason — SL | TP_FULL | EXIT | REVERSAL | RECONCILE. */
  reason: string;
  rungsFilled: number;
  rungsTotal: number;
  sandbox: boolean;
  openedAt: Date;
  closedAt: Date | null;
};

/** Realized performance for one calendar month (UTC), newest first. */
export type MonthlyView = {
  /** "2026-07" — sort/react key. */
  key: string;
  /** "Jul 2026". */
  label: string;
  trades: number;
  wins: number;
  winRate: number;
  realizedPnl: number;
};

export type LiveView = {
  profile: ProfileConfig | null;
  open: OpenPositionView | null;
  performance: PerformanceView;
  /** Recent closed trades, newest first. */
  trades: ClosedTradeView[];
  /** Realized PnL grouped by calendar month, newest first. */
  monthly: MonthlyView[];
  timeline: TimelineEvent[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const monthLabel = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

const EMPTY_PERFORMANCE: PerformanceView = {
  trades: 0, wins: 0, winRate: 0, realizedPnl: 0, avgTrade: 0, maxDrawdown: 0, avgDurationMin: 0, equity: [],
};

/** "3 min ago", "2 h ago", "5 d ago". */
export function relativeTime(at: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * Turn an `ExecutionLog` row into a line a member can read. Unknown events fall
 * back to their dotted name rather than being hidden — an event we forgot to
 * describe is still information.
 */
export function describeEvent(event: string, detail: Record<string, unknown> | null): string {
  const d = detail ?? {};
  switch (event) {
    case "position.opened": {
      const side = str(d.side) ?? "position";
      const symbol = str(d.symbol) ?? "";
      const entry = num(d.entryPrice);
      const rungs = num(d.rungsPlaced);
      const paper = d.sandbox === true ? " (paper)" : "";
      return `Opened ${side} ${symbol}${entry ? ` at ${entry}` : ""}${rungs ? ` · ${rungs} take-profits placed` : ""}${paper}`;
    }
    case "tp.filled":
      return `Take-profit filled — ${num(d.rungsFilled) ?? "?"} rung(s) closed`;
    case "stop.movedToBreakEven":
      return "Stop moved to break-even";
    case "stop.ratcheted": {
      const dist = num(d.distancePct);
      const locked = d.profitLocked === true;
      if (locked && dist !== null) return `Stop tightened to ${Math.abs(dist).toFixed(2)}% above entry — profit locked`;
      if (dist !== null && Math.abs(dist) < 1e-9) return "Stop tightened to break-even";
      return "Stop tightened after a take-profit";
    }
    case "stop.ratchetDeferred":
      return "Stop hold — price is beyond the next stop level; will retry";
    case "stop.configViolatesGeometry":
      return "Stop not moved — the bot config breaches its own soundness rule";
    case "stop.workingStopMissing":
      return "Stop replace deferred — the preset backstop still protects the position";
    case "position.closed": {
      const pnl = num(d.realizedPnl);
      const reason = str(d.reason) ?? "closed";
      const label =
        reason === "SL" ? "Stopped out"
        : reason === "EXIT" ? "Closed on exit signal"
        : reason === "TP_FULL" ? "Closed — full take-profit ladder"
        : reason === "REVERSAL" ? "Closed — replaced by a new signal"
        : `Closed (${reason.toLowerCase()})`;
      return pnl === null ? label : `${label} · ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT`;
    }
    case "position.failed":
      return `Order failed — ${str(d.userMessage) ?? "see logs"}`;
    case "symbol.substituted":
      return `Traded ${str(d.traded) ?? "a substitute"} instead of ${str(d.requested) ?? "the bot's instrument"} — not listed on the paper venue`;
    case "prepare.applied":
      return `Exchange prepared — ${num(d.leverage) ?? "?"}x leverage`;
    case "prepare.skipped":
      return `Exchange not prepared — ${str(d.reason) ?? "unknown"}`;
    case "reconcile.orphan":
      return "A position exists on the exchange that this bot did not open";
    case "pnl.attributionIncomplete":
      return "Realized PnL widened — a closing fill came from outside this bot";
    case "fanout.skip.liveNotArmed":
      return "Signal skipped — live trading is not armed";
    case "fanout.skip.positionAlreadyOpen":
      return "Signal skipped — a position is already open";
    case "fanout.skip.noConnection":
      return "Signal skipped — no exchange API key connected";
    case "fanout.skip.notReady":
      return "Signal skipped — deployment not fully configured";
    case "fanout.skip.noExchangeChosen":
      return "Signal skipped — no execution exchange chosen";
    case "fanout.skip.exchangeNotWired":
      return "Signal skipped — that exchange is not wired for trading yet";
    default:
      return event;
  }
}

/** Peak-to-trough of the cumulative realized PnL curve, in quote currency. */
export function maxDrawdown(equity: number[]): number {
  let peak = 0;
  let worst = 0;
  for (const point of equity) {
    peak = Math.max(peak, point);
    worst = Math.min(worst, point - peak);
  }
  return Math.abs(worst);
}

export async function loadLiveView(userBotId: string, config: BotConfig, riskClass: RiskClass): Promise<LiveView> {
  const profile = profileFor(config, riskClass) ?? null;

  const [openPosition, closed, logs] = await Promise.all([
    prisma.position.findFirst({
      where: { userBotId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      include: { orders: { where: { kind: "TP" }, orderBy: { rungIndex: "asc" } } },
    }),
    prisma.position.findMany({
      where: { userBotId, status: "CLOSED" },
      orderBy: { closedAt: "asc" },
      select: {
        id: true, symbol: true, side: true, entryPrice: true, realizedPnl: true,
        closedReason: true, tpRungsFilled: true, sandbox: true, createdAt: true, closedAt: true,
      },
    }),
    prisma.executionLog.findMany({
      where: { userBotId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, event: true, detail: true, level: true, createdAt: true },
    }),
  ]);

  const open: OpenPositionView | null = openPosition
    ? {
        symbol: openPosition.symbol,
        side: openPosition.side,
        size: openPosition.size,
        entryPrice: openPosition.entryPrice,
        stopPrice: openPosition.currentStopPrice,
        beMoved: openPosition.beMoved,
        rungsFilled: openPosition.tpRungsFilled,
        rungsTotal: openPosition.orders.length,
        sandbox: openPosition.sandbox,
        openedAt: openPosition.createdAt,
        rungs: openPosition.orders.map((order) => ({
          rungIndex: order.rungIndex ?? 0,
          price: order.price ?? 0,
          size: order.size,
          filled: order.state === "FILLED",
        })),
        markPrice: openPosition.lastMarkPrice,
        unrealizedPnl: openPosition.unrealizedPnl,
        markedAt: openPosition.markedAt,
      }
    : null;

  let performance = EMPTY_PERFORMANCE;
  if (closed.length > 0) {
    let running = 0;
    const equity = closed.map((position) => (running += position.realizedPnl));
    const wins = closed.filter((position) => position.realizedPnl > 0).length;
    const durations = closed
      .filter((position) => position.closedAt)
      .map((position) => (position.closedAt!.getTime() - position.createdAt.getTime()) / 60_000);

    performance = {
      trades: closed.length,
      wins,
      winRate: (wins / closed.length) * 100,
      realizedPnl: running,
      avgTrade: running / closed.length,
      maxDrawdown: maxDrawdown(equity),
      avgDurationMin: durations.length ? durations.reduce((sum, d) => sum + d, 0) / durations.length : 0,
      equity,
    };
  }

  // Every position of this bot runs the same config, so the ladder size is the profile's.
  const rungsTotal = profile?.tp.length ?? 0;
  const trades: ClosedTradeView[] = closed
    .slice(-30)
    .reverse()
    .map((position) => ({
      id: position.id,
      symbol: position.symbol,
      side: position.side,
      entryPrice: position.entryPrice,
      realizedPnl: position.realizedPnl,
      reason: position.closedReason ?? "RECONCILE",
      rungsFilled: position.tpRungsFilled,
      rungsTotal,
      sandbox: position.sandbox,
      openedAt: position.createdAt,
      closedAt: position.closedAt,
    }));

  // Realized PnL by calendar month (UTC), from the full closed set — newest month first.
  const byMonth = new Map<string, { label: string; pnls: number[] }>();
  for (const position of closed) {
    const when = position.closedAt ?? position.createdAt;
    const key = monthKey(when);
    const bucket = byMonth.get(key) ?? { label: monthLabel(when), pnls: [] };
    bucket.pnls.push(position.realizedPnl);
    byMonth.set(key, bucket);
  }
  const monthly: MonthlyView[] = [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, { label, pnls }]) => {
      const wins = pnls.filter((pnl) => pnl > 0).length;
      return { key, label, trades: pnls.length, wins, winRate: (wins / pnls.length) * 100, realizedPnl: pnls.reduce((sum, pnl) => sum + pnl, 0) };
    });

  return {
    profile,
    open,
    performance,
    trades,
    monthly,
    timeline: logs.map((log) => ({
      id: log.id,
      title: describeEvent(log.event, log.detail as Record<string, unknown> | null),
      at: log.createdAt,
      level: (log.level as TimelineEvent["level"]) ?? "info",
    })),
  };
}
