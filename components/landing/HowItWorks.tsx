import { Reveal } from "@/components/landing/Reveal";
import { SectionHeading } from "@/components/landing/SectionHeading";
import { STEPS } from "@/lib/landing-content";

/**
 * Three numbered steps connected by a horizontal gradient rail (desktop). Each
 * card lifts on hover; the rail visually threads them together left to right.
 */
export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 px-5 py-20 sm:px-8 lg:py-28">
      <div className="mx-auto max-w-7xl">
        <SectionHeading
          eyebrow="How it works"
          title="Live in"
          highlight="three steps."
          subtitle="No code, no spreadsheets, no babysitting. Connect, deploy, and let the bots compound."
        />

        <div className="relative mt-16">
          {/* connecting rail */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 top-7 hidden h-px bg-[linear-gradient(90deg,transparent,rgba(40,184,213,0.4),rgba(35,231,116,0.4),transparent)] lg:block"
          />

          <div className="grid gap-6 lg:grid-cols-3">
            {STEPS.map((step, i) => (
              <Reveal key={step.id} delay={i * 120}>
                <article className="group relative flex h-full flex-col gap-4 rounded-3xl border border-line bg-surface/60 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-accent/40">
                  <span className="relative z-[1] flex size-14 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#020344,#28B8D5)] text-xl font-bold text-white shadow-[0_0_28px_-8px_rgba(40,184,213,0.9)]">
                    {i + 1}
                  </span>
                  <h3 className="text-lg font-semibold text-white">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted">{step.description}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
