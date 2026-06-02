import { Sparkline } from "@/components/dashboard/Sparkline";
import { cn } from "@/lib/cn";

/** Animated equity-curve area chart that draws itself on mount. */
function EquityChart() {
  const line =
    "M0 96 C40 90 60 72 100 78 C140 84 165 58 210 64 C255 70 280 40 330 46 C380 52 410 28 460 22 C500 18 520 30 560 14";
  const area = `${line} L560 130 L0 130 Z`;

  return (
    <svg viewBox="0 0 560 130" preserveAspectRatio="none" className="h-36 w-full" aria-hidden>
      <defs>
        <linearGradient id="preview-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#28B8D5" stopOpacity={0.35} />
          <stop offset="100%" stopColor="#28B8D5" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="preview-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#28B8D5" />
          <stop offset="100%" stopColor="#23E774" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#preview-area)" />
      <path
        d={line}
        fill="none"
        stroke="url(#preview-stroke)"
        strokeWidth={2.5}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="draw-line"
      />
      {/* leading pulse dot */}
      <circle cx="560" cy="14" r="4" fill="#23E774" className="animate-blink" />
    </svg>
  );
}

const MINI = [
  { label: "Win rate", value: "68.4%", color: "#23E774" },
  { label: "Sharpe", value: "2.31", color: "#28B8D5" },
  { label: "Drawdown", value: "4.1%", color: "#28B8D5" },
];

const BARS = [42, 64, 38, 78, 52, 88, 60, 96, 70];

/**
 * Self-contained, glassy product preview card — an algo bot's equity curve,
 * live KPI tiles and a volume histogram. All motion is CSS so it renders on the
 * server. The `floating` variant adds the gentle hover-bob used in the hero.
 */
export function DashboardPreview({ floating = false }: { floating?: boolean }) {
  return (
    <div className={cn("relative w-full", floating && "animate-float")}>
      {/* glow under the card */}
      <div
        aria-hidden
        className="absolute -inset-4 -z-10 rounded-[32px] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(40,184,213,0.25),transparent_70%)] blur-2xl"
      />

      <div className="shimmer overflow-hidden rounded-3xl border border-line bg-surface/90 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl">
        {/* window chrome */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="flex items-center gap-2 text-xs text-muted">
            <span className="relative inline-flex text-success">
              <span className="pulse-ring relative size-2 rounded-full bg-success" />
            </span>
            Live · Momentum Bot #3
          </span>
        </div>

        <div className="flex flex-col gap-5 p-5">
          {/* equity header */}
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-muted">Portfolio value</p>
              <p className="text-2xl font-semibold text-white">
                $128,940<span className="text-muted">.22</span>
              </p>
            </div>
            <span className="rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">
              ▲ +18.6%
            </span>
          </div>

          <EquityChart />

          {/* KPI tiles */}
          <div className="grid grid-cols-3 gap-3">
            {MINI.map((m) => (
              <div key={m.label} className="rounded-2xl border border-line bg-background/60 p-3">
                <p className="text-[11px] text-muted">{m.label}</p>
                <p className="mt-0.5 text-sm font-semibold" style={{ color: m.color }}>
                  {m.value}
                </p>
                <div className="mt-1">
                  <Sparkline color={m.color} />
                </div>
              </div>
            ))}
          </div>

          {/* volume histogram */}
          <div className="flex h-16 items-end gap-1.5">
            {BARS.map((h, i) => (
              <span
                key={i}
                className="flex-1 origin-bottom rounded-t bg-[linear-gradient(to_top,#28B8D5,#3B82F6)]"
                style={{
                  height: `${h}%`,
                  animation: "ats-rise 0.8s cubic-bezier(0.22,1,0.36,1) both",
                  animationDelay: `${i * 70}ms`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
