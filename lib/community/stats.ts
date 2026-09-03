import "server-only";
import { isSubscriptionActive } from "@/lib/billing";
import type { CommunityDay } from "@/lib/community/calendar";
import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/portfolio/calendar";

/**
 * What a Community Access Link has actually produced — clicks, sign-ups, and the
 * trading volume its members went on to do.
 *
 * ## What "trade volume" means here
 *
 * The NOTIONAL a community's members have opened: `size x entryPrice` summed over
 * their positions, in quote currency. Notional, not PnL, because this figure
 * answers "how much business did this community bring", and a community whose
 * members trade heavily is valuable whether or not they had a good month.
 *
 * Sandbox (paper) positions are excluded. A demo key can open a hundred million
 * dollars of imaginary size in an afternoon, and a headline number that a member
 * can inflate for free is worse than no number at all.
 *
 * Volume is attributed by `Position.createdAt` — when the trade was OPENED —
 * because that is when the notional was committed, and it is the only timestamp
 * an open position has.
 */

/** A position reduced to the two columns notional is derived from. */
type VolumeRow = { userId: string; size: number; entryPrice: number; createdAt: Date };

const notional = (p: { size: number; entryPrice: number }) => p.size * p.entryPrice;

/** One row of the Community Access Links list. */
export type CommunitySummary = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: Date;
  clicks: number;
  signups: number;
  tradeVolume: number;
};

/**
 * Every link with its headline numbers, newest first.
 *
 * Four queries, none of them per-link: the two counts are grouped in the
 * database, and volume is folded in memory from a narrow projection of the
 * members' positions. Attribution runs member -> link in a Map rather than as a
 * join, because Prisma cannot sum a PRODUCT of two columns and this codebase has
 * no raw SQL anywhere — keeping it that way is worth one pass over a projection
 * that is four numbers wide.
 */
export async function loadCommunitySummaries(): Promise<CommunitySummary[]> {
  const links = await prisma.communityLink.findMany({ orderBy: { createdAt: "desc" } });
  if (links.length === 0) return [];

  const [clickGroups, members] = await Promise.all([
    prisma.communityLinkClick.groupBy({ by: ["linkId"], _count: { _all: true } }),
    prisma.user.findMany({
      where: { communityLinkId: { not: null } },
      select: { id: true, communityLinkId: true },
    }),
  ]);

  const positions: VolumeRow[] = members.length
    ? await prisma.position.findMany({
        where: { userId: { in: members.map((m) => m.id) }, sandbox: false },
        select: { userId: true, size: true, entryPrice: true, createdAt: true },
      })
    : [];

  const clicksByLink = new Map(clickGroups.map((g) => [g.linkId, g._count._all]));
  const linkOfMember = new Map(members.map((m) => [m.id, m.communityLinkId!]));

  const signupsByLink = new Map<string, number>();
  for (const linkId of linkOfMember.values()) {
    signupsByLink.set(linkId, (signupsByLink.get(linkId) ?? 0) + 1);
  }

  const volumeByLink = new Map<string, number>();
  for (const position of positions) {
    const linkId = linkOfMember.get(position.userId);
    if (!linkId) continue;
    volumeByLink.set(linkId, (volumeByLink.get(linkId) ?? 0) + notional(position));
  }

  return links.map((link) => ({
    id: link.id,
    name: link.name,
    slug: link.slug,
    active: link.active,
    createdAt: link.createdAt,
    clicks: clicksByLink.get(link.id) ?? 0,
    signups: signupsByLink.get(link.id) ?? 0,
    tradeVolume: volumeByLink.get(link.id) ?? 0,
  }));
}

/** One member in a community's roster. */
export type CommunityMemberRow = {
  id: string;
  name: string;
  email: string;
  /** ISO instant they registered through the link. */
  joinedAt: string;
  status: "ACTIVE" | "SUSPENDED" | "BANNED";
  /** Whether their access grant is live right now. */
  entitled: boolean;
  /** Bots they have deployed (any state). */
  deployments: number;
  /** Notional this member has opened, in quote currency. */
  volume: number;
};

export type CommunityDetail = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: string;
  /** Per-day activity, ascending; days with nothing at all are absent. */
  days: CommunityDay[];
  members: CommunityMemberRow[];
};

/**
 * Everything the community detail screen renders, or `null` when the link is
 * gone.
 *
 * The whole day-series is shipped to the browser at once — the calendar, the
 * columns and the growth chart then page through two years of history without a
 * round trip. That is affordable precisely because a day with no clicks, no
 * sign-ups and no trades produces no row: the payload tracks activity, not the
 * age of the link.
 */
export async function loadCommunityDetail(id: string): Promise<CommunityDetail | null> {
  const link = await prisma.communityLink.findUnique({ where: { id } });
  if (!link) return null;

  const [clicks, members] = await Promise.all([
    prisma.communityLinkClick.groupBy({
      by: ["day"],
      where: { linkId: id },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { communityLinkId: id },
      orderBy: { communityJoinedAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        communityJoinedAt: true,
        subscription: { select: { currentPeriodEnd: true } },
        _count: { select: { bots: true } },
      },
    }),
  ]);

  const positions: VolumeRow[] = members.length
    ? await prisma.position.findMany({
        where: { userId: { in: members.map((m) => m.id) }, sandbox: false },
        select: { userId: true, size: true, entryPrice: true, createdAt: true },
      })
    : [];

  // Fold the three sources into one day-keyed map. Everything is bucketed on the
  // UTC+2 clock via `dayKey`, including the click rows — whose `day` column was
  // written by the same function at the moment of the visit.
  const byDate = new Map<string, CommunityDay>();
  const bucket = (date: string): CommunityDay => {
    const existing = byDate.get(date);
    if (existing) return existing;
    const fresh: CommunityDay = { date, clicks: 0, signups: 0, volume: 0 };
    byDate.set(date, fresh);
    return fresh;
  };

  for (const row of clicks) bucket(row.day).clicks += row._count._all;

  for (const member of members) {
    // `communityJoinedAt` is the attribution timestamp; `createdAt` is only a
    // fallback for a row written before that column existed.
    bucket(dayKey(member.communityJoinedAt ?? member.createdAt)).signups += 1;
  }

  const volumeByMember = new Map<string, number>();
  for (const position of positions) {
    const value = notional(position);
    bucket(dayKey(position.createdAt)).volume += value;
    volumeByMember.set(position.userId, (volumeByMember.get(position.userId) ?? 0) + value);
  }

  return {
    id: link.id,
    name: link.name,
    slug: link.slug,
    active: link.active,
    createdAt: link.createdAt.toISOString(),
    days: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    members: members.map((member) => ({
      id: member.id,
      name: member.name?.trim() || member.email.split("@")[0],
      email: member.email,
      joinedAt: (member.communityJoinedAt ?? member.createdAt).toISOString(),
      status: member.status,
      entitled: isSubscriptionActive(member.subscription),
      deployments: member._count.bots,
      volume: volumeByMember.get(member.id) ?? 0,
    })),
  };
}
