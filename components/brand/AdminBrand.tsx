/**
 * Admin-surface brand lockup: a cyan icon chip (trending-up glyph) alongside
 * the "ATS-ALGO / Automated Trading" wordmark. Mirrors the 48px chip + 18px
 * title spec from the design.
 */
export function AdminBrand() {
  return (
    <div className="flex h-12 w-full items-center gap-2" aria-label="ATS-ALGO — Automated Trading">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/15 text-accent">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.667}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 17 L9.5 10.5 L13.5 14.5 L21 7" />
          <path d="M15 7 H21 V13" />
        </svg>
      </span>

      <span className="flex flex-col">
        <span className="text-[18px] font-semibold leading-[27px] tracking-[0.45px] text-accent">
          ATS-ALGO
        </span>
        <span className="text-xs leading-[18px] text-muted">Automated Trading</span>
      </span>
    </div>
  );
}
