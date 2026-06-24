"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { guestTrialFrom, guestTrialLabel } from "@/lib/guest";
import { cn } from "@/lib/cn";

function SparkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v4m0 10v4m9-9h-4M7 12H3m13.5-6.5L14 8M10 16l-2.5 2.5m9 0L14 16M10 8 7.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Prominent banner shown across the app while the viewer is on a Guest Mode
 * trial. Counts down to the deadline and routes the guest to Billing to upgrade.
 *
 * Two flavours:
 *  - active  — "Guest trial · N days left" with a soft accent treatment.
 *  - expired — a red, urgent "trial ended, subscribe to continue" bar (only seen
 *              on /billing, since every other tab bounces an expired guest here).
 *
 * The countdown is recomputed on the client from `expiresAt` so it stays live
 * without a refresh and is robust to clock skew between render and view.
 */
export function GuestTrialBanner({ expiresAt }: { expiresAt: string }) {
  const deadline = new Date(expiresAt);
  const [trial, setTrial] = useState(() => guestTrialFrom(deadline));

  useEffect(() => {
    // Re-tick every minute; enough for a day/hour countdown without churn.
    const id = setInterval(() => setTrial(guestTrialFrom(deadline)), 60_000);
    return () => clearInterval(id);
    // `expiresAt` is the only input; `deadline` is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  const expired = trial.expired;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        expired
          ? "border-[#D2031E]/40 bg-[#D2031E]/10"
          : "border-accent/40 bg-accent/10",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
            expired ? "bg-[#D2031E]/15 text-[#D2031E]" : "bg-accent/15 text-accent",
          )}
        >
          <SparkIcon />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold text-white">
            {expired ? "Your free trial has ended" : `Guest trial — ${guestTrialLabel(trial)}`}
          </p>
          <p className="text-xs leading-[18px] text-muted">
            {expired
              ? "Subscribe to unlock the dashboard, deploy bots, and track live performance."
              : "You're exploring in read-only Guest Mode. Become a member to deploy bots and unlock every tab."}
          </p>
        </div>
      </div>

      <Link
        href="/billing?gated=1"
        className={cn(
          "inline-flex h-10 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-transform hover:-translate-y-0.5",
          expired ? "bg-[#D2031E] text-white" : "bg-accent text-[#06141a]",
        )}
      >
        Become a member
      </Link>
    </div>
  );
}
