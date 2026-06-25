"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";

const W = 1000;
const H = 300;
const DD_H = 90;
const PAD_X = 4;

/** A selectable time window. `points` = trailing curve points to show. */
export type EquityPeriod = { key: string; label: string; points: number; value: string };

/** Catmull-Rom → cubic-bezier smoothing for a set of [x,y] points. */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return points.length === 1 ? `M ${points[0][0]} ${points[0][1]}` : "";
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function toPoints(series: number[], height: number): [number, number][] {
  if (series.length === 1) return [[W / 2, series[0] * height]];
  const step = (W - PAD_X * 2) / (series.length - 1);
  return series.map((v, i) => [PAD_X + i * step, v * height]);
}

/** Underwater drawdown series (0 at a new peak, growing as equity falls). */
function drawdownSeries(curveY: number[]): { dd: number[]; maxDD: number } {
  // curveY is a y-position (0 = top = best). Convert to an equity fraction.
  const equity = curveY.map((v) => 1 - v);
  let peak = -Infinity;
  let maxDD = 0;
  const dd = equity.map((e) => {
    peak = Math.max(peak, e);
    const d = peak > 0 ? Math.max(0, (peak - e) / peak) : 0;
    maxDD = Math.max(maxDD, d);
    return d;
  });
  return { dd, maxDD };
}

const Y_TICKS = [100, 75, 50, 25, 0];

/**
 * Equity Curve — an interactive area chart with a 0–100% left axis, a marked
 * current value, a time-period selector that reshapes the curve and its bottom
 * axis, and a companion drawdown ("underwater") strip beneath.
 *
 * The `curve` series is normalised 0..1 where 0 = top of the chart (best equity)
 * and 1 = bottom, so the SVG stays resolution-independent. When `periods` is
 * provided the header renders a 30D/90D/180D/360D selector; each option trims the
 * curve to its trailing window and shows that window's headline return.
 */
export function EquityChart({
  curve,
  months,
  periods,
}: {
  curve: number[];
  months: string[];
  periods?: EquityPeriod[];
}) {
  const gradientId = useId();
  const ddGradientId = useId();
  const [periodKey, setPeriodKey] = useState<string | null>(periods?.[periods.length - 1]?.key ?? null);

  const active = periods?.find((p) => p.key === periodKey) ?? null;
  const count = active ? Math.min(Math.max(2, active.points), curve.length) : curve.length;
  const series = curve.slice(-count);
  const labels = months.slice(-count);

  const points = toPoints(series, H);
  const line = smoothPath(points);
  const area = points.length >= 2 ? `${line} L ${W - PAD_X} ${H} L ${PAD_X} ${H} Z` : "";

  const lastV = series[series.length - 1] ?? 0.5;
  const currentLabel = active?.value;

  const { dd, maxDD } = drawdownSeries(series);
  const ddScale = Math.max(maxDD, 0.05); // avoid a flat/empty strip
  const ddPoints = toPoints(
    dd.map((d) => d / ddScale),
    DD_H,
  );
  const ddLine = smoothPath(ddPoints);
  const ddArea = ddPoints.length >= 2 ? `M ${PAD_X} 0 ${ddLine.slice(2)} L ${W - PAD_X} 0 Z` : "";

  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">Equity Curve</h2>
        {periods && periods.length > 0 && (
          <div className="flex gap-1 rounded-lg border border-line bg-background p-1">
            {periods.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriodKey(p.key)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                  periodKey === p.key ? "bg-accent text-[#121212]" : "text-muted hover:text-white",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Current value callout */}
      {currentLabel && (
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-xs text-muted">Current ({active?.label})</span>
          <span
            className={cn(
              "text-xl font-semibold",
              currentLabel.startsWith("-") ? "text-[#D2031E]" : "text-success",
            )}
          >
            {currentLabel}
          </span>
        </div>
      )}

      {/* Main chart with a 0–100% left axis */}
      <div className="flex gap-2">
        <div className="flex h-[300px] flex-col justify-between py-[2px] text-[10px] text-muted">
          {Y_TICKS.map((t) => (
            <span key={t}>{t}%</span>
          ))}
        </div>

        <div className="relative h-[300px] flex-1">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#28B8D5" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#28B8D5" stopOpacity={0} />
              </linearGradient>
            </defs>
            {/* horizontal gridlines at each axis tick */}
            {Y_TICKS.map((t) => (
              <line
                key={t}
                x1={0}
                x2={W}
                y1={((100 - t) / 100) * H}
                y2={((100 - t) / 100) * H}
                stroke="currentColor"
                strokeWidth={1}
                className="text-line"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {area && <path d={area} fill={`url(#${gradientId})`} />}
            <path d={line} fill="none" stroke="#28B8D5" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>

          {/* Current-value marker pinned to the last point (HTML overlay → no distortion) */}
          <span
            className="pointer-events-none absolute right-0 z-[1] size-2.5 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-surface bg-accent shadow-[0_0_8px_rgba(40,184,213,0.8)]"
            style={{ top: `${lastV * 100}%` }}
            aria-hidden
          />
        </div>
      </div>

      {/* Bottom axis — adjusts with the selected period */}
      <div className="mt-2 flex justify-between pl-[26px] pr-1 text-xs text-muted">
        {labels.map((m, i) => (
          <span key={`${m}-${i}`}>{m}</span>
        ))}
      </div>

      {/* Drawdown (underwater) strip */}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted">Drawdown</span>
        <span className="text-xs font-semibold text-[#D2031E]">Max -{(maxDD * 100).toFixed(1)}%</span>
      </div>
      <div className="mt-1 pl-[26px]">
        <svg viewBox={`0 0 ${W} ${DD_H}`} preserveAspectRatio="none" className="h-[70px] w-full" aria-hidden>
          <defs>
            <linearGradient id={ddGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#D2031E" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#D2031E" stopOpacity={0.35} />
            </linearGradient>
          </defs>
          {ddArea && <path d={ddArea} fill={`url(#${ddGradientId})`} />}
          <path d={ddLine} fill="none" stroke="#D2031E" strokeWidth={1.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </section>
  );
}
