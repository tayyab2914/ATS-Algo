"use client";

import { useMemo, useState } from "react";
import { compactMoney } from "@/lib/community/format";
import { cn } from "@/lib/cn";
import {
  buildCommunityMonth,
  buildCommunityYear,
  conversionPct,
  type CommunityDay,
  type CommunityDayCell,
  type CommunityTotals,
} from "@/lib/community/calendar";
import {
  calendarBounds,
  canStepMonth,
  canStepYear,
  MONTH_SHORT,
  stepMonth,
  WEEKDAY_SHORT,
} from "@/lib/portfolio/calendar";

/**
 * A community's activity on a calendar, as columns, and as a growth curve.
 *
 * Everything is computed in the browser from one array of active days, so paging
 * through the whole history of a link is instant and costs no round trips. That
 * array only contains days something actually happened (see `loadCommunityDetail`),
 * which is why shipping it whole is cheaper than fetching a month at a time.
 *
 * The layout deliberately mirrors the members' PnL calendar: same Monday-first
 * grid, same month/year switch, same disabled arrows at the ends of the data. An
 * operator who reads one already knows how to read this.
 */

type View = "month" | "year";

/** Which number the cells and columns are showing. */
type Metric = "signups" | "clicks" | "volume";

const METRICS: { key: Metric; label: string }[] = [
  { key: "signups", label: "Sign ups" },
  { key: "clicks", label: "Clicks" },
  { key: "volume", label: "Trade volume" },
];

const valueOf = (totals: CommunityTotals | CommunityDayCell, metric: Metric): number =>
  metric === "signups" ? totals.signups : metric === "clicks" ? totals.clicks : totals.volume;

const formatValue = (value: number, metric: Metric): string =>
  metric === "volume" ? compactMoney(value) : value.toLocaleString("en-US");

export function CommunityStats({ days, nowIso }: { days: CommunityDay[]; nowIso: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const bounds = useMemo(() => calendarBounds(days, now), [days, now]);

  const [view, setView] = useState<View>("month");
  const [metric, setMetric] = useState<Metric>("signups");
  const [cursor, setCursor] = useState(() => bounds.last);

  const month = useMemo(
    () => buildCommunityMonth(days, cursor.year, cursor.month, now),
    [days, cursor, now],
  );
  const year = useMemo(() => buildCommunityYear(days, cursor.year, now), [days, cursor.year, now]);

  const totals = view === "year" ? year.totals : month.totals;
  const periodLabel = view === "year" ? String(year.year) : month.label;
  const conversion = conversionPct(totals);

  // The period's biggest single value, which sets both the cell tint scale and
  // the column heights. Taken from the period itself so a quiet month still shows
  // contrast instead of washing out against a launch spike from a year ago.
  const peak = useMemo(() => {
    const values =
      view === "year"
        ? year.months.map((m) => valueOf(m.totals, metric))
        : month.weeks.flatMap((w) => w.days.filter((d) => d.inMonth).map((d) => valueOf(d, metric)));
    return Math.max(0, ...values);
  }, [view, year, month, metric]);

  const step = (delta: number) => {
    if (view === "year") {
      if (!canStepYear(cursor.year, delta, bounds)) return;
      setCursor((c) => ({ ...c, year: c.year + delta }));
      return;
    }
    setCursor((c) => stepMonth(c, delta, bounds));
  };

  const canBack = view === "year" ? canStepYear(cursor.year, -1, bounds) : canStepMonth(cursor, -1, bounds);
  const canForward = view === "year" ? canStepYear(cursor.year, 1, bounds) : canStepMonth(cursor, 1, bounds);

  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-4">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-11 -top-10 size-[102px] rounded-full bg-accent/20 blur-3xl"
      />

      <div className="relative flex flex-col gap-4">
        {/* Header: what period, what it produced, and the controls. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-white">Activity breakdown</h2>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-sm text-muted">{periodLabel}</span>
              <span className="text-xl font-semibold text-white">
                {formatValue(valueOf(totals, metric), metric)}
              </span>
              <span className="text-xs text-muted">
                {totals.signups.toLocaleString("en-US")} sign up{totals.signups === 1 ? "" : "s"} from{" "}
                {totals.clicks.toLocaleString("en-US")} click{totals.clicks === 1 ? "" : "s"}
                {conversion !== null && ` — ${conversion.toFixed(conversion >= 10 ? 0 : 1)}% converted`}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-lg border border-line bg-background p-1">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMetric(m.key)}
                  aria-pressed={metric === m.key}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-xs transition-colors",
                    metric === m.key ? "bg-accent font-semibold text-[#121212]" : "text-muted hover:text-white",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex gap-1 rounded-lg border border-line bg-background p-1">
              {(["month", "year"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs capitalize transition-colors",
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
                      <DayTile key={cell.date} cell={cell} metric={metric} peak={peak} />
                    ))}
                    <div className="flex flex-col items-center justify-center rounded-lg border border-line bg-background px-1 py-2">
                      <span className="text-[10px] text-muted">Week</span>
                      <span className="text-xs font-semibold text-white">
                        {formatValue(valueOf(week.totals, metric), metric)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {year.months.map((cell) => {
              const value = valueOf(cell.totals, metric);
              return (
                <div
                  key={cell.month}
                  className={cn(
                    "flex flex-col gap-1 rounded-xl border p-3",
                    cell.isFuture
                      ? "border-line/60 bg-background opacity-40"
                      : value > 0
                        ? "border-accent/30 bg-accent/[0.07]"
                        : "border-line bg-background",
                  )}
                >
                  <span className="text-[11px] font-semibold text-muted">{cell.label}</span>
                  <span className="text-lg font-semibold text-white">
                    {cell.isFuture ? "—" : formatValue(value, metric)}
                  </span>
                  <span className="text-[11px] text-muted">
                    {cell.isFuture ? " " : `${cell.cumulativeSignups} total members`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Columns — the same numbers as the grid above, shaped so the pattern
            over the period reads at a glance rather than cell by cell. */}
        <Columns
          bars={
            view === "year"
              ? year.months.map((m) => ({
                  label: m.label,
                  value: m.isFuture ? 0 : valueOf(m.totals, metric),
                }))
              : month.weeks.flatMap((w) =>
                  w.days
                    .filter((d) => d.inMonth)
                    .map((d) => ({ label: String(d.day), value: valueOf(d, metric) })),
                )
          }
          peak={peak}
          metric={metric}
        />

        {/* Growth — clicks and sign-ups on one axis, so the gap between reach and
            conversion is the shape you actually see. */}
        <GrowthChart days={days} view={view} cursor={cursor} />
      </div>
    </section>
  );
}

/** Tint strength tracks the day's size relative to the period's biggest. */
function tone(value: number, peak: number, isFuture: boolean): string {
  if (isFuture) return "border-line/40 bg-background opacity-30";
  if (value <= 0) return "border-line/60 bg-background";
  const weight = peak > 0 ? Math.min(1, value / peak) : 1;
  return weight > 0.55 ? "border-accent/45 bg-accent/15" : "border-accent/25 bg-accent/[0.07]";
}

function DayTile({ cell, metric, peak }: { cell: CommunityDayCell; metric: Metric; peak: number }) {
  const value = valueOf(cell, metric);
  return (
    <div
      className={cn(
        "flex min-h-[64px] flex-col justify-between rounded-lg border px-2 py-1.5",
        tone(value, peak, cell.isFuture),
        !cell.inMonth && "opacity-40",
        cell.isToday && "ring-1 ring-accent/60",
      )}
    >
      <span className="text-[10px] font-semibold text-muted">{cell.day}</span>
      <span className={cn("text-xs font-semibold", value > 0 ? "text-white" : "text-muted/60")}>
        {cell.isFuture ? "" : value > 0 ? formatValue(value, metric) : "—"}
      </span>
    </div>
  );
}

/**
 * A bar per bucket, scaled to the period's peak.
 *
 * Bars only — no zero baseline below the axis — because none of these numbers can
 * be negative. There are no clicks to un-click.
 */
function Columns({
  bars,
  peak,
  metric,
}: {
  bars: { label: string; value: number }[];
  peak: number;
  metric: Metric;
}) {
  const dense = bars.length > 16;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-background p-3">
      <span className="text-xs font-semibold text-muted">
        {METRICS.find((m) => m.key === metric)!.label} per {bars.length > 12 ? "day" : "month"}
      </span>
      <div className="flex h-[132px] items-end gap-[3px]">
        {bars.map((bar, i) => {
          const height = peak > 0 ? Math.max(bar.value > 0 ? 3 : 1, (bar.value / peak) * 100) : 1;
          return (
            <div key={i} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span
                title={`${bar.label}: ${formatValue(bar.value, metric)}`}
                style={{ height: `${height}%` }}
                className={cn(
                  "w-full rounded-t-[3px] transition-colors",
                  bar.value > 0 ? "bg-accent/80 group-hover:bg-accent" : "bg-line",
                )}
              />
              {!dense && <span className="text-[10px] text-muted">{bar.label}</span>}
            </div>
          );
        })}
      </div>
      {dense && (
        <div className="flex justify-between text-[10px] text-muted">
          <span>{bars[0]?.label}</span>
          <span>{bars[bars.length - 1]?.label}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Cumulative clicks and sign-ups across the visible period — the growth curve.
 *
 * Cumulative rather than per-day on purpose: a community's daily numbers are
 * spiky (one announcement, then quiet), and a spiky line answers "was yesterday
 * busy" when the question this chart is here for is "is this community still
 * growing".
 */
function GrowthChart({
  days,
  view,
  cursor,
}: {
  days: CommunityDay[];
  view: View;
  cursor: { year: number; month: number };
}) {
  const points = useMemo(() => {
    const prefix =
      view === "year" ? `${cursor.year}-` : `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-`;
    // Folded rather than mapped over mutable accumulators: React's compiler
    // rejects reassigning a captured binding inside a render-phase callback, and
    // a reduce says "running total" more plainly anyway.
    return days
      .filter((d) => d.date.startsWith(prefix))
      .reduce<{ date: string; clicks: number; signups: number }[]>((series, day) => {
        const previous = series[series.length - 1];
        series.push({
          date: day.date,
          clicks: (previous?.clicks ?? 0) + day.clicks,
          signups: (previous?.signups ?? 0) + day.signups,
        });
        return series;
      }, []);
  }, [days, view, cursor]);

  if (points.length < 2) {
    return (
      <div className="flex h-[160px] items-center justify-center rounded-xl border border-dashed border-line text-xs text-muted">
        Not enough activity in this period to chart — the curve fills in as the link is shared.
      </div>
    );
  }

  const W = 700;
  const H = 160;
  const PAD = 12;
  const max = Math.max(...points.map((p) => p.clicks), 1);

  const path = (pick: (p: (typeof points)[number]) => number) =>
    "M" +
    points
      .map((p, i) => {
        const x = (i / (points.length - 1)) * W;
        const y = H - PAD - (pick(p) / max) * (H - PAD * 2);
        return `${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" L");

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted">Cumulative growth</span>
        <div className="flex gap-4">
          <Legend color="#28B8D5" label="Clicks" />
          <Legend color="#22C55E" label="Sign ups" />
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[160px] w-full" aria-hidden>
        <path d={path((p) => p.clicks)} fill="none" stroke="#28B8D5" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <path d={path((p) => p.signups)} fill="none" stroke="#22C55E" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-muted">
        <span>{shortLabel(points[0].date)}</span>
        <span>{shortLabel(points[points.length - 1].date)}</span>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-[11px] text-muted">
      <span className="h-1 w-3 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

/** `2026-09-01` → `1 Sep`. */
function shortLabel(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(day)} ${MONTH_SHORT[Number(month) - 1]}`;
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
      className="flex size-8 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-accent/40 hover:text-white disabled:opacity-30"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {direction === "back" ? <path d="M15 5 8 12l7 7" /> : <path d="m9 5 7 7-7 7" />}
      </svg>
    </button>
  );
}
