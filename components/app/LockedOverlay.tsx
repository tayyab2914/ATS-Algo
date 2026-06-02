import Link from "next/link";

function LockIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.667" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.667" strokeLinecap="round" />
      <circle cx="12" cy="15.5" r="1.4" fill="currentColor" />
    </svg>
  );
}

/**
 * Centered "members only" card that floats over a blurred tab preview. The CTA
 * sends guests to login, carrying a `next` param so they return to the tab they
 * were trying to reach.
 */
export function LockedOverlay({ title, returnTo }: { title: string; returnTo?: string }) {
  const href = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-6">
      <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-line bg-surface/95 px-8 py-10 text-center shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <span className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
          <LockIcon />
        </span>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold text-white">{title} is locked</h2>
          <p className="text-sm leading-[21px] text-muted">
            Sign in to unlock your {title.toLowerCase()}, deploy bots, and track live performance.
          </p>
        </div>
        <Link
          href={href}
          className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#06141a] transition-transform hover:-translate-y-0.5"
        >
          Login to get full access
        </Link>
        <p className="text-xs text-muted">
          New here?{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
