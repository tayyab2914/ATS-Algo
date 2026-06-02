import { Reveal } from "@/components/landing/Reveal";
import { EXCHANGES } from "@/lib/landing-content";

/** Reverse-scrolling wall of supported exchanges — social proof of coverage. */
export function ExchangeMarquee() {
  const row = [...EXCHANGES, ...EXCHANGES];

  return (
    <section className="px-5 py-16 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Reveal className="text-center">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted">
            Trade across every major exchange
          </p>
        </Reveal>

        <div className="relative mt-8 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
          <div className="animate-marquee-reverse flex w-max items-center gap-4">
            {row.map((name, i) => (
              <span
                key={`${name}-${i}`}
                className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface/60 px-6 py-3.5 text-lg font-semibold text-heading transition-colors hover:border-accent/50 hover:text-accent"
              >
                <span className="size-2 rounded-full bg-accent/70" aria-hidden />
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
