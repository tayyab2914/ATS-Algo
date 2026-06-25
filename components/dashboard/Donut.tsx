import { HOLDINGS } from "@/lib/dashboard-data";

/** Decorative donut built from the holdings segments (visual proportions only). */
export function Donut({ size = 200, thickness = 26 }: { size?: number; thickness?: number }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = 6;

  // Pre-compute each arc length and its cumulative start offset in one pass.
  const lengths = HOLDINGS.map((holding) => (circumference * holding.segment) / 100);
  const offsets: number[] = [];
  lengths.reduce((acc, len) => {
    offsets.push(acc);
    return acc + len;
  }, 0);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {HOLDINGS.map((holding, index) => {
          const visible = Math.max(lengths[index] - gap, 0);
          return (
            <circle
              key={holding.id}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={holding.color}
              strokeWidth={thickness}
              strokeDasharray={`${visible} ${circumference - visible}`}
              strokeDashoffset={-offsets[index]}
              strokeLinecap="round"
            />
          );
        })}
      </g>
    </svg>
  );
}
