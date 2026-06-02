import type { ReactNode } from "react";

/** Section card chrome for the Admin Staging Dashboard (glow + hairline). */
export function AdminCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-line bg-surface p-4">
      <span
        aria-hidden
        className="pointer-events-none absolute -left-[45px] -top-[41px] z-0 size-[102px] rounded-full bg-accent/20 blur-[32px]"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 z-[2] h-px w-[236px] -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgba(40,184,213,0.25),transparent)]"
      />
      <div className="relative z-[1] flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold leading-6 text-white">{title}</h2>
          {subtitle && <p className="text-sm leading-[21px] text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}
