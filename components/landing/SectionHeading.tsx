import { Reveal } from "@/components/landing/Reveal";
import { cn } from "@/lib/cn";

/**
 * Centred section header used across the marketing sections: a small accent
 * eyebrow, a large title (with optional gradient emphasis) and a subtitle.
 */
export function SectionHeading({
  eyebrow,
  title,
  highlight,
  subtitle,
  className,
}: {
  eyebrow: string;
  title: string;
  highlight?: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex max-w-2xl flex-col items-center text-center", className)}>
      <Reveal>
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-accent">
          {eyebrow}
        </span>
      </Reveal>
      <Reveal delay={80}>
        <h2 className="mt-4 text-[clamp(1.9rem,4.2vw,2.9rem)] font-semibold leading-tight tracking-tight text-white">
          {title} {highlight && <span className="text-gradient">{highlight}</span>}
        </h2>
      </Reveal>
      {subtitle && (
        <Reveal delay={160}>
          <p className="mt-4 text-base leading-relaxed text-muted">{subtitle}</p>
        </Reveal>
      )}
    </div>
  );
}
