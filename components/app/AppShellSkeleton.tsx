import { Sidebar } from "@/components/dashboard/Sidebar";

/**
 * Frame-matching skeleton rendered by each route's `loading.tsx` while its
 * server component streams in. It draws the real (client) sidebar so the nav
 * stays put on tab switches, plus a pulsing placeholder where the page content
 * will land — so navigation reads as instant instead of "stuck".
 */
export function AppShellSkeleton() {
  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-white lg:flex-row">
      <Sidebar user={null} />
      <main className="flex min-w-0 flex-1 flex-col gap-6 p-4 sm:p-6">
        <div className="flex animate-pulse flex-col gap-6">
          <div className="flex flex-col gap-2">
            <div className="h-7 w-52 max-w-full rounded-lg bg-white/10" />
            <div className="h-4 w-80 max-w-full rounded-full bg-white/5" />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[120px] rounded-2xl border border-line bg-surface" />
            ))}
          </div>
          <div className="h-64 rounded-2xl border border-line bg-surface" />
          <div className="h-48 rounded-2xl border border-line bg-surface" />
        </div>
      </main>
    </div>
  );
}
