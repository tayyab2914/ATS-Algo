import { FEATURE_ICONS } from "@/components/icons";
import type { Feature } from "@/lib/content";

/**
 * A single feature tile: accent corner glow, a hairline gradient divider along
 * the top edge, an icon chip and a short description.
 */
export function FeatureCard({ icon, title, description }: Feature) {
  const Icon = FEATURE_ICONS[icon];

  return (
    <article className="relative isolate flex min-h-[108px] w-full flex-col gap-4 overflow-hidden rounded-2xl border border-line bg-surface p-4">
      {/* corner glow */}
      <span
        aria-hidden
        className="pointer-events-none absolute -left-[45px] -top-[41px] z-0 h-[102px] w-[102px] rounded-full bg-accent/20 blur-[32px]"
      />
      {/* top gradient hairline */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 z-[2] h-px w-[236px] -translate-x-1/2 bg-[linear-gradient(90deg,transparent_0%,rgba(40,184,213,0.25)_50%,transparent_100%)]"
      />

      <div className="relative z-[1] flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon />
        </span>
        <h3 className="text-xs font-semibold leading-[18px] text-white">{title}</h3>
      </div>

      <p className="relative z-[1] text-xs leading-[18px] text-muted">{description}</p>
    </article>
  );
}
