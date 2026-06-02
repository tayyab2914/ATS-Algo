import Link from "next/link";
import { BackgroundFX } from "@/components/landing/BackgroundFX";
import { Counter } from "@/components/landing/Counter";
import { DashboardPreview } from "@/components/landing/DashboardPreview";
import { Reveal } from "@/components/landing/Reveal";
import { HERO_STATS } from "@/lib/landing-content";

/**
 * Above-the-fold hero: animated background, an announcement pill, a gradient
 * headline, dual CTAs, count-up trust stats and the floating product preview.
 */
export function Hero({ loggedIn = false }: { loggedIn?: boolean }) {
  return (
    <section id="top" className="relative isolate overflow-hidden px-5 pb-20 pt-28 sm:px-8 sm:pt-32 lg:pb-28">
      <BackgroundFX />

      <div className="mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        {/* copy column */}
        <div className="flex flex-col items-start">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1.5 text-xs text-muted backdrop-blur">
              <span className="relative inline-flex text-success">
                <span className="pulse-ring relative size-1.5 rounded-full bg-success" />
              </span>
              New · AI-powered grid &amp; momentum bots
            </span>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="mt-5 text-[clamp(2.4rem,6.2vw,4.25rem)] font-semibold leading-[1.05] tracking-tight text-white">
              Automate your trading.
              <br />
              <span className="text-gradient">Maximize your returns.</span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
              Institutional-grade algorithmic bots that trade crypto, forex and commodities
              around the clock — powered by real-time market data and protected by advanced
              risk controls.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href={loggedIn ? "/dashboard" : "/signup"}
                className="group inline-flex h-12 items-center justify-center rounded-2xl bg-accent px-6 text-base font-semibold text-[#06141a] shadow-[0_0_40px_-8px_rgba(40,184,213,0.9)] transition-transform hover:-translate-y-0.5"
              >
                {loggedIn ? "My Dashboard" : "Start trading free"}
                <span aria-hidden className="ml-2 transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Link>
              <Link
                href="/bot-library"
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-accent/60 bg-accent/5 px-6 text-base font-medium text-accent backdrop-blur transition-colors hover:bg-accent/10"
              >
                <GridIcon /> Check out Bot Library
                <span aria-hidden className="transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Link>
              <a
                href="#platform"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface/50 px-6 text-base font-medium text-white backdrop-blur transition-colors hover:border-accent/60 hover:text-accent"
              >
                <PlayIcon /> See the platform
              </a>
            </div>
          </Reveal>

          <Reveal delay={320}>
            <dl className="mt-12 grid w-full max-w-lg grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
              {HERO_STATS.map((stat) => (
                <div key={stat.label} className="flex flex-col">
                  <dt className="order-2 text-xs text-muted">{stat.label}</dt>
                  <dd className="order-1 text-2xl font-semibold text-white sm:text-[1.6rem]">
                    <Counter value={stat.value} prefix={stat.prefix} suffix={stat.suffix} />
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>

        {/* preview column */}
        <Reveal delay={200} className="lg:pl-6">
          <DashboardPreview floating />
        </Reveal>
      </div>
    </section>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 9l5 3-5 3V9z" fill="currentColor" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="8" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 3v5M8 14h.01M16 14h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
