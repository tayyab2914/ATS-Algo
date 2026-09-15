import { BRAND_LOCKUP, BRAND_MARK_SIZE, BRAND_MARK_SRC, BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";

/**
 * The ATS-ALGO lockup.
 *
 * By default this is the official artwork (`public/brand/ats-lockup.png`, see
 * `BRAND_LOCKUP` in lib/brand.ts), rendered whole because it carries its own
 * typeface. With `BRAND_LOCKUP` set to null it falls back to composing the mark
 * with an Inter-set "ATS-ALGO / AUTOMATED TRADING SYSTEM" wordmark.
 *
 * ── Why it is sized the way it is ────────────────────────────────────────────
 * The narrowest place this renders is the dashboard rail: `w-64` (256px) with
 * `px-4`, leaving **224px**. The lockup must fit INSIDE that — overflow there
 * doesn't ellipsise, it runs under the rail's border and gets sliced.
 *
 *   artwork 857x144 at h-9 (36px) ≈ 214px wide
 *   fallback: mark 40 + gap 12 + max(wordmark ~140, tagline ~137) ≈ 192px
 *
 * That is the budget. If the artwork's aspect ratio changes, re-check it against
 * 224px rather than against the design canvas.
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
        className="h-9 w-auto max-w-full object-contain object-left"
      />
    );
  }

  return (
    <div
      className="flex min-w-0 max-w-full items-center gap-3"
      aria-label={`${BRAND_NAME} — Automated Trading System`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
      <img
        src={BRAND_MARK_SRC}
        alt=""
        width={BRAND_MARK_SIZE.width}
        height={BRAND_MARK_SIZE.height}
        className="h-auto w-10 shrink-0 object-contain"
      />

      <span className="min-w-0 leading-none">
        <span className="block text-[19px] font-semibold tracking-[0.18em] text-white">{BRAND_NAME}</span>
        <span className="mt-1.5 block whitespace-nowrap text-[8px] font-medium tracking-[0.1em] text-muted">
          {BRAND_TAGLINE}
        </span>
      </span>
    </div>
  );
}
