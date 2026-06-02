/**
 * Decorative, content-free skeleton used as the blurred backdrop behind the
 * locked overlay. It only needs to read as "a real dashboard lives here" — no
 * data, no interactivity.
 */
export function TabPreviewSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex h-[120px] flex-col justify-between rounded-2xl border border-line bg-surface p-4">
            <div className="h-3 w-20 rounded-full bg-white/10" />
            <div className="h-6 w-24 rounded-lg bg-white/10" />
            <div className="h-3 w-16 rounded-full bg-white/10" />
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-5 h-4 w-40 rounded-full bg-white/10" />
        <div className="h-44 rounded-xl bg-[radial-gradient(120%_120%_at_0%_0%,rgba(40,184,213,0.18),transparent_60%)]" />
      </div>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="mb-5 h-4 w-32 rounded-full bg-white/10" />
        <div className="flex flex-col gap-4">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="h-3 w-28 rounded-full bg-white/10" />
              <div className="h-3 w-16 rounded-full bg-white/10" />
              <div className="h-3 w-16 rounded-full bg-white/10" />
              <div className="h-7 w-20 rounded-full bg-white/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
