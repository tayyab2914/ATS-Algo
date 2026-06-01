import type { ReactNode } from "react";

/** Card chrome for an Account Settings section (glow + gradient hairline). */
export function SettingsCard({
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
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          {subtitle && <p className="text-xs leading-[18px] text-muted">{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Filled cyan action button used across the settings sections. */
export function PrimaryAction({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="flex h-10 w-fit items-center justify-center rounded-2xl bg-accent px-4 text-base font-semibold text-[#121212] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/** Red destructive button (Remove). */
export function DangerAction({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="flex h-10 w-fit items-center justify-center rounded-2xl bg-[#D2031E] px-4 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}
