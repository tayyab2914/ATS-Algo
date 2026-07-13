import { PALETTE, monthlyCurve } from "@/lib/dashboard/metrics";
import { prisma } from "@/lib/db";

/**
 * A member's portfolio, from what the engine actually did.
 *
 * The platform never holds funds and never connects a wallet — members keep their
 * money on their own exchange. So "balance" here means the capital a member has
 * *allocated* to bots plus the PnL those bots have *realized*. It is the only
 * balance we can state truthfully.
 */

export type PortfolioBot = {
  id: string;
  name: string;
  ticker: string | null;
  profile: string;
  active: boolean;
  capital: number;
  realized: number;
  trades: number;
  wins: number;
  winRate: number;
  openPositions: number;
  color: string;
};

export type PortfolioOverview = {
  allocated: number;
  realized: number;
  balance: number;
  openPositions: number;
  trades: number;
  wins: number;
  winRate: number;
  bestBot: PortfolioBot | null;
  worstBot: PortfolioBot | null;
  months: string[];
  curve: number[];
  bots: PortfolioBot[];
};

const PROFILE_LABEL: Record<string, string> = { LOW: "Conservative", MEDIUM: "Balanced", HIGH: "Aggressive" };

export async function loadPortfolio(userId: string, now: Date = new Date()): Promise<PortfolioOverview> {
  const deployments = await prisma.userBot.findMany({
    where: { userId },
    select: {
      active: true,
      allocatedCapital: true,
      realizedBalance: true,
      bot: { select: { id: true, name: true, ticker: true, riskClass: true } },
      positions: { select: { status: true, realizedPnl: true, closedAt: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const bots: PortfolioBot[] = deployments.map((deployment, index) => {
    const closed = deployment.positions.filter((p) => p.status === "CLOSED");
    const wins = closed.filter((p) => p.realizedPnl > 0).length;
    return {
      id: deployment.bot.id,
      name: deployment.bot.name,
      ticker: deployment.bot.ticker,
      profile: PROFILE_LABEL[deployment.bot.riskClass] ?? deployment.bot.riskClass,
      active: deployment.active,
      capital: deployment.allocatedCapital,
      realized: deployment.realizedBalance,
      trades: closed.length,
      wins,
      winRate: closed.length ? (wins / closed.length) * 100 : 0,
      openPositions: deployment.positions.filter((p) => p.status === "OPEN").length,
      color: PALETTE[index % PALETTE.length],
    };
  });

  const allocated = bots.reduce((sum, bot) => sum + bot.capital, 0);
  const realized = bots.reduce((sum, bot) => sum + bot.realized, 0);
  const trades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const wins = bots.reduce((sum, bot) => sum + bot.wins, 0);

  const traded = bots.filter((bot) => bot.trades > 0);
  const ranked = [...traded].sort((a, b) => b.realized - a.realized);

  const allClosed = deployments.flatMap((deployment) =>
    deployment.positions.filter((p): p is { status: "CLOSED"; realizedPnl: number; closedAt: Date } => p.status === "CLOSED" && p.closedAt !== null),
  );
  const { labels, curve } = monthlyCurve(allClosed, 8, now);

  return {
    allocated,
    realized,
    balance: allocated + realized,
    openPositions: bots.reduce((sum, bot) => sum + bot.openPositions, 0),
    trades,
    wins,
    winRate: trades ? (wins / trades) * 100 : 0,
    bestBot: ranked[0] ?? null,
    worstBot: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    months: labels,
    curve,
    bots,
  };
}
