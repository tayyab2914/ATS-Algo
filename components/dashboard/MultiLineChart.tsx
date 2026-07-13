/**
 * An overlaid multi-series line chart. Every series shares one min/max so the
 * lines are directly comparable. Used for Monthly Equity (Total PnL% vs an
 * optional benchmark) and any other two-series view. Single-series callers get a
 * plain line — no fabricated second line when a benchmark isn't available.
 *
 * Flat at zero when nothing has traded, drawn rather than invented.
 */
export type LineSeries = { label: string; color: string; points: number[] };

export function MultiLineChart({
  series,
  labels,
  height = 240,
}: {
  series: LineSeries[];
  labels?: string[];
  height?: number;
}) {
  const lengths = series.map((s) => s.points.length);
  const n = Math.max(0, ...lengths);
  if (n < 2) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-line text-xs text-muted" style={{ height }}>
        No closed trades yet — this fills in as your bots trade.
      </div>
    );
  }

  const W = 700;
  const all = series.flatMap((s) => s.points);
  const min = Math.min(...all, 0);
  const max = Math.max(...all, 0);
  const span = max - min || 1;
  const zeroY = 190 - ((0 - min) / span) * 170;

  const pathFor = (points: number[]): string => {
    const coords = points.map((v, i) => {
      const x = (i / (n - 1)) * W;
      const y = 190 - ((v - min) / span) * 170;
      return `${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return `M${coords.join(" L")}`;
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-4">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-2 text-xs text-muted">
            <span className="h-1 w-3 rounded-full" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 700 200" preserveAspectRatio="none" style={{ height }} className="w-full" aria-hidden>
        <line x1="0" y1={zeroY} x2="700" y2={zeroY} stroke="#8A8F98" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity={0.4} />
        {series.map((s) => (
          <path key={s.label} d={pathFor(s.points)} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {labels && (
        <div className="flex justify-between text-[11px] text-muted">
          {labels.map((l, i) => (
            <span key={i} className="flex-1 text-center">
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
