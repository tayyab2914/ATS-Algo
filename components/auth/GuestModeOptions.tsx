import Link from "next/link";
import type { AuthMode } from "@/lib/auth-config";
import { GUEST_TRIAL_DAYS } from "@/lib/guest";

function RocketIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2m6.5-3.5a13 13 0 0 0 4-9.5c0-1-.5-1.5-1.5-1.5a13 13 0 0 0-9.5 4L5 10l2 2m4.5 4.5L14 14m-2.5 2.5L9 14m2.5 2.5L12 19m2-9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 18h16M4 18l-1.5-9 5 4L12 6l4.5 7 5-4L20 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Per-surface copy for the Guest path; the credential form sits right below. */
const GUEST_COPY: Record<AuthMode, { title: string; body: string }> = {
  login: {
    title: "Log in as Guest",
    body: `Explore free for ${GUEST_TRIAL_DAYS} days, no card required — sign in below.`,
  },
  signup: {
    title: "Sign up as Guest",
    body: `Get ${GUEST_TRIAL_DAYS} days free, no card required — create your account below.`,
  },
};

/**
 * The two paths offered on the login and signup cards:
 *  - Guest — the credential form right below grants a free, read-only
 *    {@link GUEST_TRIAL_DAYS}-day trial (the clock starts on first login). This
 *    card just frames that choice; the wording adapts to {@link AuthMode}.
 *  - Become a Member — routes to Billing to pick a paid plan (full access).
 *
 * Rendered above the form so the choice is the first thing a visitor sees.
 */
export function GuestModeOptions({ mode = "login" }: { mode?: AuthMode }) {
  const guest = GUEST_COPY[mode];
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-2xl border border-accent/40 bg-accent/10 p-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <RocketIcon />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white">{guest.title}</span>
            <span className="text-xs leading-[18px] text-muted">{guest.body}</span>
          </div>
        </div>
      </div>

      <Link
        href="/billing?gated=1"
        className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface p-3 transition-colors hover:border-accent/40"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-accent">
          <CrownIcon />
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-white">Become a Member</span>
          <span className="text-xs leading-[18px] text-muted">
            Unlock every tab, deploy bots, and track live performance.
          </span>
        </div>
        <span aria-hidden className="ml-auto text-muted">
          →
        </span>
      </Link>
    </div>
  );
}
