/** Decorative full-width area chart (cyan), no data/axes. */
export function AreaChart() {
  const line =
    "M0 120 C40 110 70 95 110 100 C150 105 180 80 220 85 C260 90 290 70 330 72 C370 74 400 55 440 60 C480 65 510 48 550 52 C590 56 620 45 700 40";
  const area = `${line} L700 200 L0 200 Z`;

  return (
    <svg viewBox="0 0 700 200" preserveAspectRatio="none" className="h-[200px] w-full" aria-hidden>
      <defs>
        <linearGradient id="portfolio-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#28B8D5" stopOpacity={0.25} />
          <stop offset="100%" stopColor="#28B8D5" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#portfolio-area)" />
      <path d={line} fill="none" stroke="#28B8D5" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
