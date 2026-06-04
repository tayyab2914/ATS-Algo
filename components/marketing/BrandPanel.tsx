import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";
import { FeatureCard } from "@/components/marketing/FeatureCard";
import { StatList } from "@/components/marketing/StatList";
import { FEATURES, HERO } from "@/lib/content";

/**
 * Left half of the screen: brand lockup, hero copy, feature cards and stats.
 * Purely presentational — safe to render on the server. Content is capped at
 * 512px and scales its type/padding down on small screens.
 *
 * Hidden below `lg`: on phones/tablets the auth + admin surfaces show only the
 * form, so this marketing column is suppressed rather than stacked on top.
 *
 * @param brand - Top-of-panel lockup. Defaults to the ADRIAN <Logo>; the admin
 *                surface passes its own ATS-ALGO mark.
 */
export function BrandPanel({ brand = <Logo /> }: { brand?: ReactNode }) {
  return (
    <section className="hidden w-full flex-col items-start justify-center bg-surface px-6 py-12 sm:px-10 lg:flex lg:flex-1 lg:px-16 lg:py-16">
      <div className="flex w-full max-w-[512px] flex-col items-start gap-4">
        {brand}

        <h1 className="text-[clamp(1.75rem,5vw,2.5rem)] font-semibold leading-[1.2] text-white">
          {HERO.title} <span className="text-accent">{HERO.highlight}</span>
        </h1>

        <p className="text-sm leading-[21px] text-muted">{HERO.description}</p>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.id} {...feature} />
          ))}
        </div>

        <StatList />
      </div>
    </section>
  );
}
