import { Reveal } from "@/components/landing/Reveal";
import { SectionHeading } from "@/components/landing/SectionHeading";
import { TESTIMONIALS } from "@/lib/landing-content";

/** Social-proof cards with avatar monogram, quote and a five-star rating. */
export function Testimonials() {
  return (
    <section id="reviews" className="scroll-mt-24 px-5 py-20 sm:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="Loved by traders"
          title="Built for people who"
          highlight="hate babysitting charts."
          subtitle="Thousands of traders run their strategies on Adrian every day. Here's what a few of them say."
        />

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.id} delay={i * 110}>
              <figure className="flex h-full flex-col gap-5 rounded-3xl border border-line bg-surface/60 p-7 transition-colors duration-300 hover:border-accent/40">
                <div className="flex gap-1 text-accent" aria-label="5 out of 5 stars">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <StarIcon key={s} />
                  ))}
                </div>
                <blockquote className="flex-1 text-sm leading-relaxed text-heading">
                  “{t.quote}”
                </blockquote>
                <figcaption className="flex items-center gap-3 border-t border-line pt-5">
                  <span className="flex size-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#020344,#28B8D5)] text-sm font-semibold text-white">
                    {t.initials}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold text-white">{t.name}</span>
                    <span className="text-xs text-muted">{t.role}</span>
                  </span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l2.9 6.2 6.6.8-4.9 4.5 1.3 6.5L12 17.8 6.1 20l1.3-6.5L2.5 9l6.6-.8L12 2z" />
    </svg>
  );
}
