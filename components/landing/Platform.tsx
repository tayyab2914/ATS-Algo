import { DashboardPreview } from "@/components/landing/DashboardPreview";
import { Reveal } from "@/components/landing/Reveal";

const HIGHLIGHTS = [
  {
    title: "One cockpit for every bot",
    body: "Equity curves, win rate, Sharpe and drawdown for all of your strategies in a single real-time view.",
  },
  {
    title: "Millisecond execution",
    body: "Co-located order routing fills your strategy the instant a signal fires — not seconds later.",
  },
  {
    title: "Risk that never sleeps",
    body: "Per-bot exposure caps and trailing stops are enforced server-side, even if your laptop is closed.",
  },
];

/**
 * Split showcase: persuasive copy + a checklist on the left, the live product
 * preview on the right. Mirrors the app's own dashboard so the marketing claim
 * matches the product reality.
 */
export function Platform() {
  return (
    <section
      id="platform"
      className="relative scroll-mt-24 overflow-hidden border-y border-line bg-surface/30 px-5 py-20 sm:px-8 lg:py-28"
    >
      {/* ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]"
      />

      <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-2">
        <div className="flex flex-col">
          <Reveal>
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-accent">
              The platform
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="mt-4 text-[clamp(1.9rem,4.2vw,2.9rem)] font-semibold leading-tight tracking-tight text-white">
              A trading desk that <span className="text-gradient">runs itself.</span>
            </h2>
          </Reveal>
          <Reveal delay={160}>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-muted">
              Monitor performance, manage risk and tune strategies from one beautifully simple
              dashboard — the same one powering live capital right now.
            </p>
          </Reveal>

          <ul className="mt-8 flex flex-col gap-5">
            {HIGHLIGHTS.map((item, i) => (
              <Reveal key={item.title} as="li" delay={220 + i * 90} className="flex gap-4">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-success/30 bg-success/10 text-success">
                  <CheckIcon />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-white">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{item.body}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>

        <Reveal delay={120}>
          <DashboardPreview />
        </Reveal>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5l4 4 10-10"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
