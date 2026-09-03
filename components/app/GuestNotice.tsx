/**
 * The standing banner a read-only guest carries across every tab.
 *
 * It replaces the old Guest Mode trial countdown, and the difference is the
 * point: there is no clock any more and nothing to buy, so this states what the
 * account can do and how it changes, rather than pressuring anybody. The route in
 * is a community invite link — an individual account is welcome to browse for as
 * long as it likes.
 *
 * A server component with no state, so it costs nothing on every page it sits on.
 */
export function GuestNotice() {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <EyeIcon />
      </span>

      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-white">Guest access — read only</span>
        <span className="text-xs leading-[18px] text-muted">
          You can explore the dashboard and the bot library. Deploying and running bots is enabled for
          community members — join through your community&apos;s invite link, or ask an admin to enable it
          for this account.
        </span>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}
