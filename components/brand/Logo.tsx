import { BRAND_LOCKUP, BRAND_MARK_SIZE, BRAND_MARK_SRC, BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";

/**
 * The ATS-ALGO lockup: the mark plus the "ATS-ALGO / AUTOMATED TRADING SYSTEM"
 * wordmark.
 *
 * The mark is an image (`public/brand/ats-mark.svg`), not inline SVG, so the
 * official artwork replaces it by overwriting that one file — see lib/brand.ts.
 * If a full lockup with its own typography is supplied instead, `BRAND_LOCKUP`
 * points at it and this renders that image whole rather than re-typesetting the
 * wordmark in Inter.
 */
export function Logo() {
  if (BRAND_LOCKUP) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a fixed-size brand asset from /public; the optimizer adds nothing and would need an SVG opt-in
      <img
        src={BRAND_LOCKUP.src}
        alt={BRAND_NAME}
        width={BRAND_LOCKUP.width}
        height={BRAND_LOCKUP.height}
        className="h-12 w-auto max-w-[248px] object-contain object-left"
      />
    );
  }

  return (
    <div className="flex h-12 w-[248px] items-center gap-3.5" aria-label={`${BRAND_NAME} — Automated Trading System`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        src={BRAND_MARK_SRC}
        alt=""
        width={BRAND_MARK_SIZE.width}
        height={BRAND_MARK_SIZE.height}
        className="h-10 w-12 shrink-0 object-contain"
      />

      <span className="h-8 w-px bg-white/15" aria-hidden />

      <span className="leading-none">
        <span className="block text-[22px] font-semibold tracking-[0.22em] text-white">{BRAND_NAME}</span>
        <span className="mt-1.5 block whitespace-nowrap text-[9px] font-medium tracking-[0.18em] text-muted">
          {BRAND_TAGLINE}
        </span>
      </span>
    </div>
  );
}
