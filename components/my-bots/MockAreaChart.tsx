const W = 1000;
const H = 300;
const PAD_X = 4;

const MONTHS = ["Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"];
// A gently rising demo equity shape (0 = bottom, 1 = top of the plot).
const SERIES = [0.42, 0.46, 0.44, 0.52, 0.6, 0.58, 0.66, 0.74];

/** Catmull-Rom → cubic-bezier smoothing, matching the library EquityChart. */
function smoothPath(points: [number, number][]): string {
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

/**
 * A decorative, static area chart used for the "Trade Visualization" and
 * "Performance Overview" panels. Pure SVG (server-renderable) — no live data
 * feed exists yet, so the curve is a fixed demo shape.
 */
export function MockAreaChart({ id }: { id: string }) {
  const step = (W - PAD_X * 2) / (SERIES.length - 1);
  const points: [number, number][] = SERIES.map((v, i) => [PAD_X + i * step, (1 - v) * H]);
  const line = smoothPath(points);
  const area = `${line} L ${W - PAD_X} ${H} L ${PAD_X} ${H} Z`;

  return (
    <div>
      <div className="h-[220px] w-full sm:h-[260px]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#28B8D5" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#28B8D5" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
          <path
            d={line}
            fill="none"
            stroke="#28B8D5"
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        {MONTHS.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </div>
  );
}
