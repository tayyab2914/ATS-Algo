/**
 * The Portfolio PnL calendar — realized profit and loss laid out on a real
 * calendar, per day, per week, per month and per year.
 *
 * Every figure is REALIZED: a trade lands on the day it CLOSED, because that is
 * the day its result became a fact. Open positions contribute nothing, so a cell
 * never moves once its day is over — which is the only way a calendar can be read
 * as a record rather than a live quote.
 *
 * The clock is UTC+2, matching lib/dashboard/window.ts, and weeks start on Monday.
 * A fixed offset rather than a named zone is deliberate: the platform reports on one
 * clock everywhere, so "Tuesday" means the same instant for every member and a cell
 * cannot change value because the reader moved country.
 *
 * Pure — no database, no clock of its own (pass `now`). {@link loadDailyPnl} in
 * overview/analytics is the only part that touches Prisma.
 */

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
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Monday-first, matching `windowStart("weekly")`. */
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const pad = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` for an instant, on the UTC+2 clock. ISO order, so keys sort as dates. */
export function dayKey(at: Date | number): string {
  const d = new Date((typeof at === "number" ? at : at.getTime()) + OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `YYYY-MM-DD` for a calendar date already expressed in UTC+2 terms. */
const keyOfLocal = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

/** One closed trade, reduced to what the calendar needs. */
export type CalendarTrade = { realizedPnl: number; marginUsed: number; closedAt: Date };

/** One day's realized result. Days with no closed trade are simply absent. */
export type DayPnl = {
  /** `YYYY-MM-DD`, UTC+2. */
  date: string;
  pnl: number;
  /** Collateral behind the day's trades — the denominator for the day's return %. */
  margin: number;
  trades: number;
};

/**
 * Bucket closed trades into days. Sorted by date, and only days that actually
 * traded are present: an empty day is the absence of a row, not a zero, so the
 * payload stays proportional to activity rather than to the length of the account's
 * history.
 */
export function computeDailyPnl(trades: CalendarTrade[]): DayPnl[] {
  const byDay = new Map<string, DayPnl>();
  for (const trade of trades) {
    const date = dayKey(trade.closedAt);
    const bucket = byDay.get(date) ?? { date, pnl: 0, margin: 0, trades: 0 };
    bucket.pnl += trade.realizedPnl;
    bucket.margin += trade.marginUsed;
    bucket.trades += 1;
    byDay.set(date, bucket);
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Aggregate totals shared by a day, a week, a month and a year. */
export type Totals = {
  pnl: number;
  margin: number;
  trades: number;
  /** Days that closed at least one trade — "3 of 22 trading days", not "3 days". */
  tradingDays: number;
};

const EMPTY: Totals = { pnl: 0, margin: 0, trades: 0, tradingDays: 0 };

const add = (totals: Totals, day: DayPnl): Totals => ({
  pnl: totals.pnl + day.pnl,
  margin: totals.margin + day.margin,
  trades: totals.trades + day.trades,
  tradingDays: totals.tradingDays + 1,
});

const sumDays = (days: DayPnl[]): Totals => days.reduce(add, EMPTY);

/** Return on the capital actually committed, %. Null when nothing was committed. */
export const returnPct = (totals: Totals): number | null =>
  totals.margin > 0 ? (totals.pnl / totals.margin) * 100 : null;

// ── Month view ───────────────────────────────────────────────────────────────

export type DayCell = {
  date: string;
  /** Day of the month, 1-31. */
  day: number;
  /** False for the leading/trailing days that pad the grid to whole weeks. */
  inMonth: boolean;
  isToday: boolean;
  /** True for a date that hasn't happened yet — rendered as absent, not as flat. */
  isFuture: boolean;
  pnl: number;
  margin: number;
  trades: number;
};

export type WeekRow = {
  /** ISO date of the week's Monday — a stable React key. */
  key: string;
  days: DayCell[];
  /** The week's totals, counting ONLY the days inside the displayed month. */
  totals: Totals;
};

export type MonthView = {
  year: number;
  /** 0-11. */
  month: number;
  label: string;
  weeks: WeekRow[];
  /** Everything that closed inside this month. */
  totals: Totals;
  /** Best and worst single day in the month, or null when it never traded. */
  bestDay: DayPnl | null;
  worstDay: DayPnl | null;
  /** Realized PnL from the account's first trade through the END of this month. */
  cumulative: number;
};

/** Days in a calendar month, on the UTC+2 clock. */
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Monday-first weekday index (0-6) of a local calendar date. */
const mondayIndex = (year: number, month: number, day: number) =>
  (new Date(Date.UTC(year, month, day)).getUTCDay() + 6) % 7;

/**
 * One month as a Monday-first grid of whole weeks.
 *
 * The padding days from the neighbouring months are rendered but never counted:
 * a week's total is the week's contribution TO THIS MONTH, so the twelve monthly
 * totals add up to the year and no trade is counted twice.
 */
export function buildMonthView(days: DayPnl[], year: number, month: number, now: Date = new Date()): MonthView {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const todayKey = dayKey(now);
  const count = daysInMonth(year, month);
  const lead = mondayIndex(year, month, 1);
  const cells = Math.ceil((lead + count) / 7) * 7;

  // Walk in real instants so month and year boundaries take care of themselves.
  const gridStart = Date.UTC(year, month, 1) - lead * DAY_MS;
  const weeks: WeekRow[] = [];

  for (let cell = 0; cell < cells; cell++) {
    const at = new Date(gridStart + cell * DAY_MS);
    const cellYear = at.getUTCFullYear();
    const cellMonth = at.getUTCMonth();
    const cellDay = at.getUTCDate();
    const date = keyOfLocal(cellYear, cellMonth, cellDay);
    const found = byDate.get(date);

    const dayCell: DayCell = {
      date,
      day: cellDay,
      inMonth: cellYear === year && cellMonth === month,
      isToday: date === todayKey,
      isFuture: date > todayKey,
      pnl: found?.pnl ?? 0,
      margin: found?.margin ?? 0,
      trades: found?.trades ?? 0,
    };

    if (cell % 7 === 0) weeks.push({ key: date, days: [], totals: { ...EMPTY } });
    const week = weeks[weeks.length - 1];
    week.days.push(dayCell);
    // Only days belonging to THIS month contribute — see the doc comment.
    if (dayCell.inMonth && found) week.totals = add(week.totals, found);
  }

  const monthPrefix = `${year}-${pad(month + 1)}-`;
  const inMonth = days.filter((d) => d.date.startsWith(monthPrefix));
  const monthEnd = keyOfLocal(year, month, count);

  return {
    year,
    month,
    label: `${MONTH_LABELS[month]} ${year}`,
    weeks,
    totals: sumDays(inMonth),
    bestDay: inMonth.length ? inMonth.reduce((best, d) => (d.pnl > best.pnl ? d : best)) : null,
    worstDay: inMonth.length ? inMonth.reduce((worst, d) => (d.pnl < worst.pnl ? d : worst)) : null,
    // Lexicographic works because the keys are zero-padded ISO dates.
    cumulative: days.filter((d) => d.date <= monthEnd).reduce((sum, d) => sum + d.pnl, 0),
  };
}

// ── Year view ────────────────────────────────────────────────────────────────

export type MonthCell = {
  year: number;
  month: number;
  label: string;
  totals: Totals;
  /** Running total WITHIN the year, through the end of this month. */
  cumulative: number;
  /** True for a month that hasn't started yet. */
  isFuture: boolean;
};

export type YearView = {
  year: number;
  months: MonthCell[];
  /** Everything that closed inside this year. */
  totals: Totals;
  bestMonth: MonthCell | null;
  worstMonth: MonthCell | null;
  /** Realized PnL from the account's first trade through the END of this year. */
  cumulative: number;
};

/** Twelve month cells with a running year-to-date beside each — the zoomed-out view. */
export function buildYearView(days: DayPnl[], year: number, now: Date = new Date()): YearView {
  const nowLocal = new Date(now.getTime() + OFFSET_MS);
  const nowYear = nowLocal.getUTCFullYear();
  const nowMonth = nowLocal.getUTCMonth();

  let running = 0;
  const months: MonthCell[] = [];
  for (let month = 0; month < 12; month++) {
    const totals = sumDays(days.filter((d) => d.date.startsWith(`${year}-${pad(month + 1)}-`)));
    running += totals.pnl;
    months.push({
      year,
      month,
      label: MONTH_SHORT[month],
      totals,
      cumulative: running,
      isFuture: year > nowYear || (year === nowYear && month > nowMonth),
    });
  }

  const traded = months.filter((m) => m.totals.trades > 0);
  return {
    year,
    months,
    totals: sumDays(days.filter((d) => d.date.startsWith(`${year}-`))),
    bestMonth: traded.length ? traded.reduce((best, m) => (m.totals.pnl > best.totals.pnl ? m : best)) : null,
    worstMonth: traded.length ? traded.reduce((worst, m) => (m.totals.pnl < worst.totals.pnl ? m : worst)) : null,
    cumulative: days.filter((d) => d.date <= `${year}-12-31`).reduce((sum, d) => sum + d.pnl, 0),
  };
}

// ── Navigation bounds ────────────────────────────────────────────────────────

/**
 * The window the arrows may move through: from the account's first trade to the
 * current month, inclusive.
 *
 * Bounded forwards because realized PnL cannot exist in the future — an arrow into
 * next month can only ever show an empty grid. Bounded backwards at the first trade
 * for the same reason. Both ends stay open to at least the current month so a fresh
 * account still renders a calendar rather than an error.
 */
export type CalendarBounds = { first: { year: number; month: number }; last: { year: number; month: number } };

export function calendarBounds(days: readonly { date: string }[], now: Date = new Date()): CalendarBounds {
  const nowLocal = new Date(now.getTime() + OFFSET_MS);
  const last = { year: nowLocal.getUTCFullYear(), month: nowLocal.getUTCMonth() };
  const earliest = days[0]?.date;
  if (!earliest) return { first: last, last };
  const [year, month] = earliest.split("-").map(Number);
  const first = { year, month: month - 1 };
  // A clock skew or a hand-edited row must never produce an empty range.
  return first.year * 12 + first.month > last.year * 12 + last.month ? { first: last, last } : { first, last };
}

/** Step a (year, month) cursor, clamped to {@link calendarBounds}. */
export function stepMonth(cursor: { year: number; month: number }, delta: number, bounds: CalendarBounds) {
  const index = cursor.year * 12 + cursor.month + delta;
  const min = bounds.first.year * 12 + bounds.first.month;
  const max = bounds.last.year * 12 + bounds.last.month;
  const clamped = Math.min(max, Math.max(min, index));
  return { year: Math.floor(clamped / 12), month: clamped % 12 };
}

/** Can the cursor still move in this direction? Drives the arrow's disabled state. */
export function canStepMonth(cursor: { year: number; month: number }, delta: number, bounds: CalendarBounds): boolean {
  const next = stepMonth(cursor, delta, bounds);
  return next.year !== cursor.year || next.month !== cursor.month;
}

export function canStepYear(year: number, delta: number, bounds: CalendarBounds): boolean {
  const next = year + delta;
  return next >= bounds.first.year && next <= bounds.last.year;
}
