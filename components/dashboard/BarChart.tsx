/**
 * A data-driven SVG bar chart. Bars grow from a zero baseline, so negative
 * values hang below it and positive above — the same "where zero sits" honesty
 * the AreaChart uses. Positive bars take `color`, negative bars take `negColor`.
 *
 * All zeros (an account that hasn't traded) render as a flat row of baseline
 * ticks rather than an empty box, so the axis still reads.
 */
export function BarChart({
  values,
  labels,
  color = "#28B8D5",
  negColor = "#D2031E",
  height = 240,
}: {
  values: number[];
  labels: string[];
  color?: string;
  negColor?: string;
  height?: number;
}) {
  const W = 320;
  const H = 256;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const zeroY = H - ((0 - min) / span) * H;

  const n = values.length || 1;
  const slot = W / n;
  const barW = Math.max(2, slot * 0.55);

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height }} className="w-full" aria-hidden>
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#2A2A2A" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => {
          const x = i * slot + (slot - barW) / 2;
          const vY = H - ((v - min) / span) * H;
          const y = Math.min(vY, zeroY);
          const h = Math.max(1, Math.abs(vY - zeroY));
          return (
            <rect key={i} x={x} y={y} width={barW} height={h} rx={2} fill={v < 0 ? negColor : color} opacity={v === 0 ? 0.25 : 0.9} />
          );
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-muted">
        {labels.map((l, i) => (
          <span key={i} className="flex-1 text-center">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
