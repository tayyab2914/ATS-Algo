/**
 * Adrian Trading System wordmark — the chevron mark plus the "ADRIAN /
 * TRADING SYSTEM" lockup, rendered as SVG so it stays crisp at any scale.
 *
 * NOTE: the source design references a raster export (`upscale_image.png`).
 * Drop that file into `/public` and swap this component for a <Image> if a
 * pixel-identical logo is required.
 */
export function Logo() {
  return (
    <div className="flex h-12 w-[216px] items-center gap-3.5" aria-label="Adrian Trading System">
      <svg
        width="48"
        height="40"
        viewBox="0 0 48 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path d="M2 8 L20 8 L14 14 L8 14 Z" fill="#2F7BFF" />
        <path d="M2 19 L11 11 L42 11 L34 19 Z" fill="#3B82F6" />
        <path d="M2 19 L34 19 L28 25 L8 25 Z" fill="#2563EB" />
        <path d="M14 28 L46 28 L40 34 L20 34 Z" fill="#2F7BFF" />
      </svg>

      <span className="h-8 w-px bg-white/15" aria-hidden />

      <span className="leading-none">
        <span className="block text-[22px] font-semibold tracking-[0.22em] text-white">
          ADRIAN
        </span>
        <span className="mt-1.5 block text-[9px] font-medium tracking-[0.32em] text-muted">
          TRADING SYSTEM
        </span>
      </span>
    </div>
  );
}
