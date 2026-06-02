import Link from "next/link";
import { Reveal } from "@/components/landing/Reveal";

/**
 * Closing conversion panel: a glowing gradient slab with a rotating conic ring,
 * a panning grid and the primary sign-up CTA.
 */
export function CtaSection() {
  return (
    <section className="px-5 py-20 sm:px-8 lg:py-28">
      <Reveal className="mx-auto max-w-5xl">
        <div className="relative isolate overflow-hidden rounded-[2rem] border border-line bg-surface px-6 py-16 text-center sm:px-12">
          {/* panning grid */}
          <div aria-hidden className="bg-grid absolute inset-0 opacity-40" />
          {/* gradient wash */}
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(80%_120%_at_50%_-10%,rgba(40,184,213,0.25),transparent_70%)]"
          />
          {/* slow conic ring accent */}
          <div
            aria-hidden
            className="animate-spin-slow gradient-ring absolute -right-24 -top-24 size-64 rounded-full opacity-40 blur-2xl"
          />

          <div className="relative z-[1] flex flex-col items-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-background/60 px-3 py-1.5 text-xs text-muted backdrop-blur">
              <span className="relative inline-flex text-success">
                <span className="pulse-ring relative size-1.5 rounded-full bg-success" />
              </span>
              No credit card required
            </span>

            <h2 className="mt-6 text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.1] tracking-tight text-white">
              Put your trading <span className="text-gradient">on autopilot.</span>
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted">
              Join 1,200+ traders automating their edge. Spin up your first bot in minutes —
              free to start, cancel anytime.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="group inline-flex h-12 items-center justify-center rounded-2xl bg-accent px-7 text-base font-semibold text-[#06141a] shadow-[0_0_44px_-8px_rgba(40,184,213,0.95)] transition-transform hover:-translate-y-0.5"
              >
                Create free account
                <span aria-hidden className="ml-2 transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center justify-center rounded-2xl border border-line bg-background/40 px-7 text-base font-medium text-white backdrop-blur transition-colors hover:border-accent/60 hover:text-accent"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
