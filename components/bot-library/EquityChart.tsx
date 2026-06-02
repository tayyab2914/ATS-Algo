"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";

const W = 1000;
const H = 300;
const PAD_X = 4;

/** Catmull-Rom → cubic-bezier smoothing for a set of [x,y] points. */
function smoothPath(points: [number, number][]): string {
  if (points.length < 2) return "";
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

function toPoints(series: number[]): [number, number][] {
  const step = (W - PAD_X * 2) / (series.length - 1);
  return series.map((v, i) => [PAD_X + i * step, v * H]);
}

/**
 * Monthly equity area chart with an Equity Curve / Safe Risk Profile toggle.
 * Series arrive as normalised 0..1 values (1 = chart top) so the SVG stays
 * resolution-independent and the curve is generated, not hand-drawn.
 */
export function EquityChart({
  curve,
  safe,
  months,
}: {
  curve: number[];
  safe: number[];
  months: string[];
}) {
  const [mode, setMode] = useState<"curve" | "safe">("curve");
  const gradientId = useId();

  const series = mode === "curve" ? curve : safe;
  const points = toPoints(series);
  const line = smoothPath(points);
  const area = `${line} L ${W - PAD_X} ${H} L ${PAD_X} ${H} Z`;

  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-white">Monthly Equity</h2>
          <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-semibold text-accent">
            360-Day-Period
          </span>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-background p-1">
          {(
            [
              ["curve", "Equity Curve"],
              ["safe", "Safe Risk Profile"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                mode === key ? "bg-accent text-[#121212]" : "text-muted hover:text-white",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[260px] w-full sm:h-[320px]" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#28B8D5" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#28B8D5" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke="#28B8D5"
          strokeWidth={2}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-3 flex justify-between px-1 text-xs text-muted">
        {months.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </section>
  );
}
