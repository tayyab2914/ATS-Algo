/**
 * Decorative, non-interactive background layer for the hero: an animated
 * hairline grid, three drifting colour orbs (cyan / blue / green to match the
 * app palette) and a vignette that fades the grid into the page. Purely
 * presentational and `aria-hidden`.
 */
export function BackgroundFX() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* panning grid */}
      <div className="bg-grid absolute inset-0 opacity-60" />

      {/* radial vignette so the grid melts toward the edges + bottom */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_-10%,transparent_30%,var(--color-background)_75%)]" />

      {/* drifting glow orbs */}
      <div className="animate-orb absolute -left-24 top-10 h-72 w-72 rounded-full bg-accent/25 blur-[90px]" />
      <div
        className="animate-orb absolute -right-16 top-40 h-80 w-80 rounded-full bg-[#2563eb]/25 blur-[100px]"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="animate-orb absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-success/15 blur-[90px]"
        style={{ animationDelay: "-12s" }}
      />
    </div>
  );
}
