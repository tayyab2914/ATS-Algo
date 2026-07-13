/** An 80×40 area sparkline over a real series. Blank when there's nothing to plot. */
export function Sparkline({ color, points }: { color: string; points: number[] }) {
  if (points.length < 2) return <span className="block h-10 w-20" aria-hidden />;

  const gradientId = `spark-${color.replace("#", "")}`;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;

  const coords = points.map((value, index) => {
    const x = 2 + (index / (points.length - 1)) * 76;
    const y = 34 - ((value - min) / span) * 26;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = `M${coords.join(" L")}`;
  const area = `${line} L78 40 L2 40 Z`;

  return (
    <svg width="80" height="40" viewBox="0 0 80 40" fill="none" aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
