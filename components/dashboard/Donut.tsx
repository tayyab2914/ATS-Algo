import type { AllocationSlice } from "@/lib/dashboard/metrics";

/** Capital allocated across the member's deployed bots. */
export function Donut({ slices, size = 200, thickness = 26 }: { slices: AllocationSlice[]; size?: number; thickness?: number }) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = slices.length > 1 ? 6 : 0;

  if (slices.length === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#2A2E35" strokeWidth={thickness} />
      </svg>
    );
  }

  const lengths = slices.map((slice) => (circumference * slice.pct) / 100);
  const offsets: number[] = [];
  lengths.reduce((acc, length) => {
    offsets.push(acc);
    return acc + length;
  }, 0);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {slices.map((slice, index) => {
          const visible = Math.max(lengths[index] - gap, 0);
          return (
            <circle
              key={slice.id}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={slice.color}
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
