/** Decorative 80×40 area sparkline (no data — purely visual). */
export function Sparkline({ color }: { color: string }) {
  const gradientId = `spark-${color.replace("#", "")}`;
  const line = "M2 30 L13 26 L24 28 L35 18 L46 21 L57 13 L68 15 L78 8";
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
