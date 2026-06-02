import { FEATURE_ICONS } from "@/components/icons";
import { Reveal } from "@/components/landing/Reveal";
import { SectionHeading } from "@/components/landing/SectionHeading";
import { LANDING_FEATURES } from "@/lib/landing-content";

/**
 * Six-up capability grid. Each card has a spotlight glow that follows nothing
 * (pure CSS), a gradient hairline along the top edge and an icon chip — echoing
 * the in-app FeatureCard styling but scaled up for the marketing surface.
 */
export function Features() {
  return (
    <section id="features" className="scroll-mt-24 px-5 py-20 sm:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Capabilities"
          title="Everything you need to"
          highlight="trade on autopilot."
          subtitle="A complete automation stack — from strategy deployment to risk enforcement — built for traders who'd rather sleep than stare at candles."
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {LANDING_FEATURES.map((feature, i) => {
            const Icon = FEATURE_ICONS[feature.icon];
            return (
              <Reveal key={feature.id} delay={(i % 3) * 90}>
                <article className="group relative isolate flex h-full flex-col gap-4 overflow-hidden rounded-3xl border border-line bg-surface/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:bg-surface">
                  {/* corner glow on hover */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -right-10 -top-10 z-0 h-32 w-32 rounded-full bg-accent/0 blur-3xl transition-colors duration-500 group-hover:bg-accent/25"
                  />
                  {/* top gradient hairline */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-6 top-0 z-[2] h-px bg-[linear-gradient(90deg,transparent,rgba(40,184,213,0.5),transparent)]"
                  />

                  <span className="relative z-[1] flex size-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent transition-transform duration-300 group-hover:scale-110">
                    <Icon width={22} height={22} />
                  </span>

                  <h3 className="relative z-[1] text-lg font-semibold text-white">{feature.title}</h3>
                  <p className="relative z-[1] text-sm leading-relaxed text-muted">
                    {feature.description}
                  </p>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
