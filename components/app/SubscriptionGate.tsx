import Link from "next/link";
import type { ReactNode } from "react";
import { ScrollLock } from "@/components/app/ScrollLock";

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
 * "Plan not active" lock shown to a signed-in user without an active
 * subscription. Renders the tab's content blurred and inert with a centered
 * modal that sends them to /billing to subscribe — the paid-user counterpart to
 * {@link GuestGate} (which sends guests to login). Rendered in place so the tab
 * opens instantly instead of redirecting.
 */
export function SubscriptionGate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none max-h-[70vh] select-none overflow-hidden blur-[6px] saturate-50 opacity-50">
        {children}
      </div>
      <ScrollLock />
      <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-6">
        <div className="pointer-events-auto flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-line bg-surface/95 px-8 py-10 text-center shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)] backdrop-blur-xl">
          <span className="flex size-14 items-center justify-center rounded-full bg-accent/10 text-accent">
            <LockIcon />
          </span>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-lg font-semibold text-white">Plan not active</h2>
            <p className="text-sm leading-[21px] text-muted">
              Subscribe to any plan to unlock your {title.toLowerCase()}, deploy bots, and track live
              performance.
            </p>
          </div>
          <Link
            href="/billing?gated=1"
            className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#06141a] transition-transform hover:-translate-y-0.5"
          >
            View plans &amp; subscribe
          </Link>
        </div>
      </div>
    </div>
  );
}
