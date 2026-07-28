"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import {
  buildMonthView,
  buildYearView,
  calendarBounds,
  canStepMonth,
  canStepYear,
  MONTH_SHORT,
  returnPct,
  stepMonth,
  WEEKDAY_SHORT,
  type DayCell,
  type DayPnl,
  type MonthCell,
  type Totals,
} from "@/lib/portfolio/calendar";

/**
 * Realized PnL on a calendar — a month of days, or a year of months.
 *
 * Everything is computed in the browser from one array of trading days, so
 * paging through two years of history is instant and costs no round trips. That
 * array is only as long as the number of days the account actually traded (see
 * `computeDailyPnl`), which is why shipping it whole is cheaper than fetching a
 * month at a time.
 *
 * The colour IS the data here: a cell's tint encodes the sign and the text carries
 * the amount, so a month reads at a glance and then rewards a closer look. Cells are
 * buttons only where there is something to drill into — a month in the year view —
 * because a control that does nothing when clicked is worse than a div.
 */

// Shared colour language: green = profit, red = loss, flat = a day that traded to
// zero, hollow = a day that never traded. Also used by the drilldown panel.
const POS = "text-success";
const NEG = "text-[#D2031E]";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
/** Compact form for a day cell, where the column is ~90px wide. */
const moneyShort = (n: number) => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs >= 100) return `${sign}$${Math.round(abs)}`;
  return `${sign}$${abs.toFixed(2)}`;
};
const signedPct = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(2)}%`;

const toneText = (pnl: number) => (pnl > 0 ? POS : pnl < 0 ? NEG : "text-muted");

/** Tint strength tracks the day's size relative to the month's biggest move. */
function cellTone(pnl: number, trades: number, peak: number): string {
  if (trades === 0) return "border-line/60 bg-background";
  if (pnl === 0) return "border-line bg-surface";
  const weight = peak > 0 ? Math.min(1, Math.abs(pnl) / peak) : 1;
  const strong = weight > 0.55;
  return pnl > 0
    ? strong
      ? "border-success/45 bg-success/15"
      : "border-success/25 bg-success/[0.07]"
    : strong
      ? "border-[#D2031E]/45 bg-[#D2031E]/15"
      : "border-[#D2031E]/25 bg-[#D2031E]/[0.07]";
}

export type PnlCalendarProps = {
  /** Days that closed at least one trade, ascending. */
  days: DayPnl[];
  /** Server render time, so "today" is the server's UTC+2 day and not the browser's. */
  nowIso: string;
};

type View = "month" | "year";

export function PnlCalendar({ days, nowIso }: PnlCalendarProps) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const bounds = useMemo(() => calendarBounds(days, now), [days, now]);

  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => bounds.last);

  const month = useMemo(() => buildMonthView(days, cursor.year, cursor.month, now), [days, cursor, now]);
  const year = useMemo(() => buildYearView(days, cursor.year, now), [days, cursor.year, now]);
  const [selected, setSelected] = useState<string | null>(null);

  const selectedDay = useMemo(
    () => (selected ? (days.find((d) => d.date === selected) ?? null) : null),
    [selected, days],
  );

  // The month's largest single-day move, which sets the tint scale. Taken from the
  // month itself so a quiet month still shows contrast instead of washing out
  // against some outlier from a year ago.
  const peak = useMemo(
    () => Math.max(Math.abs(month.bestDay?.pnl ?? 0), Math.abs(month.worstDay?.pnl ?? 0)),
    [month],
  );

  const step = (delta: number) => {
    if (view === "year") {
      if (!canStepYear(cursor.year, delta, bounds)) return;
      setCursor((c) => ({ ...c, year: c.year + delta }));
    } else {
      setCursor((c) => stepMonth(c, delta, bounds));
    }
    setSelected(null);
  };

  const canBack = view === "year" ? canStepYear(cursor.year, -1, bounds) : canStepMonth(cursor, -1, bounds);
  const canForward = view === "year" ? canStepYear(cursor.year, 1, bounds) : canStepMonth(cursor, 1, bounds);

  const periodTotals = view === "year" ? year.totals : month.totals;
  const periodCumulative = view === "year" ? year.cumulative : month.cumulative;
  const periodLabel = view === "year" ? String(year.year) : month.label;
  const pct = returnPct(periodTotals);

  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-4">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-11 -top-10 size-[102px] rounded-full bg-accent/20 blur-3xl"
      />

      <div className="relative flex flex-col gap-4">
        {/* Header: period, its result, and the two controls. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-white">PnL Calendar</h2>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm text-muted">{periodLabel}</span>
              <span className={cn("text-xl font-semibold", toneText(periodTotals.pnl))}>
                {periodTotals.trades > 0 ? moneyShort(periodTotals.pnl) : "—"}
              </span>
              {pct !== null && <span className={cn("text-xs font-semibold", toneText(periodTotals.pnl))}>{signedPct(pct)}</span>}
              <span className="text-xs text-muted">
                {periodTotals.trades > 0
                  ? `${periodTotals.trades} trade${periodTotals.trades === 1 ? "" : "s"} over ${periodTotals.tradingDays} day${periodTotals.tradingDays === 1 ? "" : "s"}`
                  : "no closed trades"}
              </span>
            </div>
            <span className="text-xs text-muted">
              Cumulative to end of {view === "year" ? year.year : MONTH_SHORT[month.month]}:{" "}
              <span className={cn("font-semibold", toneText(periodCumulative))}>{money(periodCumulative)}</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-line bg-background p-1">
              {(["month", "year"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setView(v);
                    setSelected(null);
                  }}
                  aria-pressed={view === v}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs leading-[18px] capitalize transition-colors",
                    view === v ? "bg-accent font-semibold text-[#121212]" : "text-muted hover:text-white",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <StepButton direction="back" disabled={!canBack} onClick={() => step(-1)} label={`Previous ${view}`} />
              <StepButton direction="forward" disabled={!canForward} onClick={() => step(1)} label={`Next ${view}`} />
            </div>
          </div>
        </div>

        {view === "month" ? (
          <>
            {/* Weekday header + a column for the week's own total. */}
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-[repeat(7,minmax(0,1fr))_92px] gap-1.5 pb-1.5">
                  {WEEKDAY_SHORT.map((d) => (
                    <span key={d} className="px-1 text-center text-[11px] font-semibold text-muted">
                      {d}
                    </span>
                  ))}
                  <span className="px-1 text-center text-[11px] font-semibold text-muted">Week</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  {month.weeks.map((week) => (
                    <div key={week.key} className="grid grid-cols-[repeat(7,minmax(0,1fr))_92px] gap-1.5">
                      {week.days.map((cell) => (
                        <DayTile
                          key={cell.date}
                          cell={cell}
                          peak={peak}
                          selected={selected === cell.date}
                          onSelect={() => setSelected(selected === cell.date ? null : cell.date)}
                        />
                      ))}
                      <WeekTile totals={week.totals} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {selectedDay ? <DayDetail day={selectedDay} /> : <MonthExtremes month={month} />}
          </>
        ) : (
          <YearGrid
            months={year.months}
            onOpen={(m) => {
              setCursor({ year: m.year, month: m.month });
              setView("month");
              setSelected(null);
            }}
          />
        )}
      </div>
    </section>
  );
}

/** One day. A button only when the day has something to show. */
function DayTile({
  cell,
  peak,
  selected,
  onSelect,
}: {
  cell: DayCell;
  peak: number;
  selected: boolean;
  onSelect: () => void;
}) {
  // A padding day belongs to a neighbouring month and is deliberately NOT in this
  // month's week total, so its amount is not shown: printing +$930 next to a week
  // that reads +$753 invites exactly the arithmetic the reader is trying to do. The
  // date stays, so the week still reads as a week.
  const showValue = cell.inMonth && cell.trades > 0;

  const shell = cn(
    "flex h-[68px] flex-col justify-between rounded-lg border p-1.5 text-left transition-colors",
    cell.inMonth ? cellTone(cell.pnl, cell.trades, peak) : "border-line/40 bg-background/40",
    !cell.inMonth && "opacity-45",
    cell.isToday && "ring-1 ring-accent",
    selected && "ring-2 ring-accent",
  );

  const body = (
    <>
      <span className={cn("text-[11px] leading-none", cell.isToday ? "font-semibold text-accent" : "text-muted")}>
        {cell.day}
      </span>
      {showValue ? (
        <span className="flex flex-col gap-0.5">
          <span className={cn("text-[13px] font-semibold leading-none", toneText(cell.pnl))}>{moneyShort(cell.pnl)}</span>
          <span className="text-[10px] leading-none text-muted">
            {cell.trades} trade{cell.trades === 1 ? "" : "s"}
          </span>
        </span>
      ) : (
        <span className="text-[10px] leading-none text-muted/50">{cell.isFuture || !cell.inMonth ? "" : "—"}</span>
      )}
    </>
  );

  if (!showValue) {
    return <div className={shell}>{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${cell.date}: ${money(cell.pnl)} over ${cell.trades} trades`}
      className={cn(shell, "hover:border-accent/60")}
    >
      {body}
    </button>
  );
}

/** The week's contribution to the displayed month. */
function WeekTile({ totals }: { totals: Totals }) {
  const pct = returnPct(totals);
  return (
    <div className="flex h-[68px] flex-col justify-center gap-0.5 rounded-lg border border-line bg-background px-2">
      {totals.trades > 0 ? (
        <>
          <span className={cn("text-[13px] font-semibold leading-none", toneText(totals.pnl))}>{moneyShort(totals.pnl)}</span>
          {pct !== null && <span className="text-[10px] leading-none text-muted">{signedPct(pct)}</span>}
          <span className="text-[10px] leading-none text-muted">
            {totals.tradingDays} day{totals.tradingDays === 1 ? "" : "s"}
          </span>
        </>
      ) : (
        <span className="text-[11px] leading-none text-muted/50">—</span>
      )}
    </div>
  );
}

/** Twelve months, each with its own result and the year-to-date beside it. */
function YearGrid({ months, onOpen }: { months: MonthCell[]; onOpen: (month: MonthCell) => void }) {
  const peak = Math.max(...months.map((m) => Math.abs(m.totals.pnl)), 0);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {months.map((m) => {
        const pct = returnPct(m.totals);
        const traded = m.totals.trades > 0;
        const shell = cn(
          "flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors",
          cellTone(m.totals.pnl, m.totals.trades, peak),
          m.isFuture && "opacity-40",
        );
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-white">{m.label}</span>
              {traded && (
                <span className="text-[10px] text-muted">
                  {m.totals.trades} trade{m.totals.trades === 1 ? "" : "s"}
                </span>
              )}
            </span>
            <span className={cn("text-lg font-semibold leading-none", toneText(m.totals.pnl))}>
              {traded ? moneyShort(m.totals.pnl) : "—"}
            </span>
            <span className="flex items-baseline justify-between gap-2 text-[10px] leading-none text-muted">
              <span>{pct !== null ? signedPct(pct) : " "}</span>
              <span>
                YTD <span className={cn("font-semibold", toneText(m.cumulative))}>{moneyShort(m.cumulative)}</span>
              </span>
            </span>
          </>
        );
        if (!traded) {
          return (
            <div key={m.month} className={shell}>
              {body}
            </div>
          );
        }
        return (
          <button
            key={m.month}
            type="button"
            onClick={() => onOpen(m)}
            aria-label={`Open ${m.label}: ${money(m.totals.pnl)}`}
            className={cn(shell, "hover:border-accent/60")}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

/** What a clicked day actually contained. */
function DayDetail({ day }: { day: DayPnl }) {
  const pct = day.margin > 0 ? (day.pnl / day.margin) * 100 : null;
  const date = new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
      <span className="text-sm font-semibold text-white">{date}</span>
      <Figure label="Realized" value={money(day.pnl)} tone={toneText(day.pnl)} />
      <Figure label="Return on margin" value={pct === null ? "—" : signedPct(pct)} tone={toneText(day.pnl)} />
      <Figure label="Margin used" value={money(day.margin)} />
      <Figure label="Trades closed" value={String(day.trades)} />
    </div>
  );
}

/** The month's two most interesting days — shown until a day is picked. */
function MonthExtremes({ month }: { month: ReturnType<typeof buildMonthView> }) {
  if (!month.bestDay || !month.worstDay) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-background px-4 py-3 text-xs text-muted">
        No trades closed in {month.label}. Pick another month, or switch to the year view.
      </p>
    );
  }
  const dayOf = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-background px-4 py-3">
      <span className="text-xs text-muted">Click any day for its detail.</span>
      <Figure label={`Best day · ${dayOf(month.bestDay.date)}`} value={money(month.bestDay.pnl)} tone={toneText(month.bestDay.pnl)} />
      <Figure label={`Worst day · ${dayOf(month.worstDay.date)}`} value={money(month.worstDay.pnl)} tone={toneText(month.worstDay.pnl)} />
      <Figure label="Trading days" value={String(month.totals.tradingDays)} />
    </div>
  );
}

function Figure({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className={cn("text-sm font-semibold", tone)}>{value}</span>
    </span>
  );
}

function StepButton({
  direction,
  disabled,
  onClick,
  label,
}: {
  direction: "back" | "forward";
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={disabled ? `No data ${direction === "back" ? "before this" : "after this"}` : label}
      className="flex size-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-line disabled:hover:text-muted"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path
          d={direction === "back" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
