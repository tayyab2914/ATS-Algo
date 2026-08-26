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
 *
 * ── Why it is sized the way it is ────────────────────────────────────────────
 * The narrowest place this renders is the dashboard rail: `w-64` (256px) with
 * `px-4`, leaving **224px**. The lockup must fit INSIDE that, because the type is
 * heavily letter-spaced and the tagline cannot wrap — overflow there doesn't
 * ellipsise, it runs under the rail's border and gets sliced.
 *
 *   mark 40 + gap 12 + max(wordmark ~140, tagline ~137) ≈ 192px
 *
 * That is the budget. The old lockup asked for a fixed 248px in a 208px box (it
 * used `px-6` and a `w-[248px]` child) and clipped on every screen. If the type
 * scale changes, re-check it against 224px rather than against the design canvas.
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
        className="h-10 w-auto max-w-full object-contain object-left"
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
        className="h-[33px] w-10 shrink-0 object-contain"
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
