/**
 * The portfolio equity curve: cumulative realized PnL, one point per month.
 * A flat line at zero is the truth for an account that hasn't traded — we draw it
 * rather than invent a rising curve.
 */
export function AreaChart({ points }: { points: number[] }) {
  if (points.length < 2) {
    return (
      <div className="flex h-[200px] items-center justify-center rounded-xl border border-dashed border-line text-xs text-muted">
        No closed trades yet — the curve fills in as your bots trade.
      </div>
    );
  }

  const min = Math.min(...points, 0);
  const max = Math.max(...points, 0);
  const span = max - min || 1;

  const coords = points.map((value, index) => {
    const x = (index / (points.length - 1)) * 700;
    const y = 190 - ((value - min) / span) * 170;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  const line = `M${coords.join(" L")}`;
  const area = `${line} L700 200 L0 200 Z`;
  // Where zero sits, so gains and losses read differently at a glance.
  const zeroY = 190 - ((0 - min) / span) * 170;

  return (
    <svg viewBox="0 0 700 200" preserveAspectRatio="none" className="h-[200px] w-full" aria-hidden>
      <defs>
        <linearGradient id="portfolio-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#28B8D5" stopOpacity={0.25} />
          <stop offset="100%" stopColor="#28B8D5" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#portfolio-area)" />
      <line x1="0" y1={zeroY} x2="700" y2={zeroY} stroke="#8A8F98" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" opacity={0.4} />
      <path d={line} fill="none" stroke="#28B8D5" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
