import { BRAND_MARK_SIZE, BRAND_MARK_SRC, BRAND_NAME } from "@/lib/brand";

/**
 * Admin-surface brand lockup: the mark in a cyan chip alongside the
 * "ATS-ALGO / Automated Trading" wordmark. Mirrors the 48px chip + 18px title
 * spec from the design.
 *
 * The glyph comes from `public/brand/ats-mark.svg`, the same file `<Logo>` reads,
 * so the official artwork lands on both surfaces from one file drop — see
 * lib/brand.ts.
 */
export function AdminBrand() {
  return (
    <div className="flex h-12 w-full items-center gap-2" aria-label={`${BRAND_NAME} — Automated Trading`}>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/15">
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed-size brand asset from /public; the optimizer adds nothing and would need an SVG opt-in */}
        <img
          src={BRAND_MARK_SRC}
          alt=""
          width={BRAND_MARK_SIZE.width}
          height={BRAND_MARK_SIZE.height}
          className="h-6 w-7 object-contain"
        />
      </span>

      <span className="flex flex-col">
        <span className="text-[18px] font-semibold leading-[27px] tracking-[0.45px] text-accent">{BRAND_NAME}</span>
        <span className="text-xs leading-[18px] text-muted">Automated Trading</span>
      </span>
    </div>
  );
}
