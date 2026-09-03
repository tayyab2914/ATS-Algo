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
 * "Members only" lock shown to a signed-in guest — an account with no access
 * grant. Renders the tab's content blurred and inert behind a centered card, in
 * place, so the tab still opens instantly instead of redirecting.
 *
 * It carries NO call to action, and that is deliberate. There is nothing to buy
 * and no request queue any more: access arrives either with a community's invite
 * link (which grants it at registration) or from an admin flipping this account
 * to Member. A button that only ever led to a page saying "ask someone else"
 * was worse than telling them plainly here. The counterpart for signed-out
 * visitors is {@link GuestGate}, which does have somewhere to send them — login.
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
            <h2 className="text-lg font-semibold text-white">Members only</h2>
            <p className="text-sm leading-[21px] text-muted">
              Your {title.toLowerCase()} unlocks for community members. Join through your community&apos;s
              invite link, or ask an admin to enable bot access for this account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
