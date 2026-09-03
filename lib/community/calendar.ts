/**
 * The Community Access Link calendar — clicks, sign-ups and trade volume laid out
 * on the same grid the Portfolio PnL calendar uses.
 *
 * Deliberately the same shape as `lib/portfolio/calendar.ts`: an operator who has
 * learned to read one should not have to learn the other. The navigation
 * primitives (`calendarBounds`, `stepMonth`, …) are imported from there rather
 * than re-implemented, so the two calendars can never drift apart on what "you
 * can't page into the future" means.
 *
 * The clock is UTC+2, matching the rest of the platform, and weeks start on
 * Monday. Pure — no Prisma, no clock of its own (pass `now`). {@link loadCommunityDetail}
 * in `stats.ts` is the only part that touches the database.
 */

import { dayKey, MONTH_SHORT } from "@/lib/portfolio/calendar";

const OFFSET_MS = 120 * 60_000; // UTC+2
const DAY_MS = 86_400_000;

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const keyOfLocal = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

/**
 * One day of a community's activity. Days with nothing at all are simply absent —
 * a quiet link costs one row per active day, not one per day since it was made.
 */
export type CommunityDay = {
  /** `YYYY-MM-DD`, UTC+2. */
  date: string;
  /** Unique visitors that opened the link that day (see the CommunityLinkClick model). */
  clicks: number;
  /** Accounts registered through the link that day. */
  signups: number;
  /** Notional opened by this community's members that day, in quote currency. */
  volume: number;
};

export type CommunityTotals = {
  clicks: number;
  signups: number;
  volume: number;
  /** Days that saw any activity at all — "6 of 30 days", not "6 days". */
  activeDays: number;
};

export const EMPTY_TOTALS: CommunityTotals = { clicks: 0, signups: 0, volume: 0, activeDays: 0 };

const add = (totals: CommunityTotals, day: CommunityDay): CommunityTotals => ({
  clicks: totals.clicks + day.clicks,
  signups: totals.signups + day.signups,
  volume: totals.volume + day.volume,
  activeDays: totals.activeDays + 1,
});

const sumDays = (days: CommunityDay[]): CommunityTotals => days.reduce(add, EMPTY_TOTALS);

/**
 * Share of visitors that went on to register, %. Null when nobody has visited —
 * a conversion rate over zero clicks is a division by zero dressed up as a
 * statistic.
 *
 * Can exceed 100%: somebody can be handed the invite link's destination directly,
 * or register from a device that already counted its click on an earlier day. It
 * is reported as-is rather than clamped, because a rate above 100 is real
 * information (the link is being forwarded past the landing page).
 */
export const conversionPct = (totals: CommunityTotals): number | null =>
  totals.clicks > 0 ? (totals.signups / totals.clicks) * 100 : null;

// ── Month view ───────────────────────────────────────────────────────────────

export type CommunityDayCell = {
  date: string;
  /** Day of the month, 1-31. */
  day: number;
  /** False for the leading/trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
  isToday: boolean;
  /** True for a date that hasn't happened yet — rendered as absent, not as empty. */
  isFuture: boolean;
  clicks: number;
  signups: number;
  volume: number;
};

export type CommunityWeekRow = {
  /** ISO date of the week's Monday — a stable React key. */
  key: string;
  days: CommunityDayCell[];
  /** The week's totals, counting ONLY the days inside the displayed month. */
  totals: CommunityTotals;
};

export type CommunityMonthView = {
  year: number;
  /** 0-11. */
  month: number;
  label: string;
  weeks: CommunityWeekRow[];
  totals: CommunityTotals;
  /** The month's busiest sign-up day, or null if nobody joined. */
  bestDay: CommunityDay | null;
};

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const mondayIndex = (year: number, month: number, day: number) =>
  (new Date(Date.UTC(year, month, day)).getUTCDay() + 6) % 7;

/**
 * One month as a Monday-first grid of whole weeks.
 *
 * Padding days from the neighbouring months are rendered but never counted, so
 * the twelve monthly totals add up to the year and no sign-up is counted twice.
 */
export function buildCommunityMonth(
  days: CommunityDay[],
  year: number,
  month: number,
  now: Date = new Date(),
): CommunityMonthView {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const todayKey = dayKey(now);
  const count = daysInMonth(year, month);
  const lead = mondayIndex(year, month, 1);
  const cells = Math.ceil((lead + count) / 7) * 7;

  // Walk in real instants so month and year boundaries take care of themselves.
  const gridStart = Date.UTC(year, month, 1) - lead * DAY_MS;
  const weeks: CommunityWeekRow[] = [];

  for (let cell = 0; cell < cells; cell++) {
    const at = new Date(gridStart + cell * DAY_MS);
    const cellYear = at.getUTCFullYear();
    const cellMonth = at.getUTCMonth();
    const cellDay = at.getUTCDate();
    const date = keyOfLocal(cellYear, cellMonth, cellDay);
    const found = byDate.get(date);

    const dayCell: CommunityDayCell = {
      date,
      day: cellDay,
      inMonth: cellYear === year && cellMonth === month,
      isToday: date === todayKey,
      isFuture: date > todayKey,
      clicks: found?.clicks ?? 0,
      signups: found?.signups ?? 0,
      volume: found?.volume ?? 0,
    };

    if (cell % 7 === 0) weeks.push({ key: date, days: [], totals: { ...EMPTY_TOTALS } });
    const week = weeks[weeks.length - 1];
    week.days.push(dayCell);
    if (dayCell.inMonth && found) week.totals = add(week.totals, found);
  }

  const inMonth = days.filter((d) => d.date.startsWith(`${year}-${pad(month + 1)}-`));
  const joined = inMonth.filter((d) => d.signups > 0);

  return {
    year,
    month,
    label: `${MONTH_LABELS[month]} ${year}`,
    weeks,
    totals: sumDays(inMonth),
    bestDay: joined.length ? joined.reduce((best, d) => (d.signups > best.signups ? d : best)) : null,
  };
}

// ── Year view ────────────────────────────────────────────────────────────────

export type CommunityMonthCell = {
  year: number;
  month: number;
  label: string;
  totals: CommunityTotals;
  /** Sign-ups from January through the end of this month — the growth curve. */
  cumulativeSignups: number;
  isFuture: boolean;
};

export type CommunityYearView = {
  year: number;
  months: CommunityMonthCell[];
  totals: CommunityTotals;
  bestMonth: CommunityMonthCell | null;
};

/** Twelve month cells with a running sign-up total beside each. */
export function buildCommunityYear(
  days: CommunityDay[],
  year: number,
  now: Date = new Date(),
): CommunityYearView {
  const nowLocal = new Date(now.getTime() + OFFSET_MS);
  const nowYear = nowLocal.getUTCFullYear();
  const nowMonth = nowLocal.getUTCMonth();

  let running = 0;
  const months: CommunityMonthCell[] = [];
  for (let month = 0; month < 12; month++) {
    const totals = sumDays(days.filter((d) => d.date.startsWith(`${year}-${pad(month + 1)}-`)));
    running += totals.signups;
    months.push({
      year,
      month,
      label: MONTH_SHORT[month],
      totals,
      cumulativeSignups: running,
      isFuture: year > nowYear || (year === nowYear && month > nowMonth),
    });
  }

  const joined = months.filter((m) => m.totals.signups > 0);
  return {
    year,
    months,
    totals: sumDays(days.filter((d) => d.date.startsWith(`${year}-`))),
    bestMonth: joined.length
      ? joined.reduce((best, m) => (m.totals.signups > best.totals.signups ? m : best))
      : null,
  };
}
