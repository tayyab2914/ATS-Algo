"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="m3 8.5 3.2 3.2L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="10" width="16" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * "Add to My Bots" CTA, gated by what the viewer is allowed to do:
 *  - visitor   → routed to login (with a return path); the action needs an account.
 *  - guest     → deploying is a paid feature, so routed to Billing to upgrade.
 *  - member    → optimistic added/added-back toggle.
 *
 * Guests can browse bot profiles read-only but can't deploy until they're members.
 */
export function AddToMyBotsButton({
  slug,
  authed,
  canDeploy,
}: {
  slug: string;
  /** Whether the viewer is signed in at all. */
  authed: boolean;
  /** Whether the viewer may actually deploy (member/admin). */
  canDeploy: boolean;
}) {
  const router = useRouter();
  const [added, setAdded] = useState(false);

  function handleClick() {
    if (!authed) {
      router.push(`/login?next=${encodeURIComponent(`/bot-library/${slug}`)}`);
      return;
    }
    if (!canDeploy) {
      // Signed-in guest: deploying needs a membership.
      router.push("/billing?gated=1");
      return;
    }
    setAdded((v) => !v);
  }

  // Signed-in guests see a "members only" affordance instead of the add toggle.
  const locked = authed && !canDeploy;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={added}
      title={locked ? "Deploying bots is a members-only feature" : undefined}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors",
        locked
          ? "border border-line bg-surface text-muted hover:border-accent/40 hover:text-white"
          : added
            ? "border border-success/40 bg-success/10 text-success"
            : "bg-accent text-[#06141a] hover:opacity-90",
      )}
    >
      {locked ? <LockIcon /> : added ? <CheckIcon /> : <PlusIcon />}
      {locked ? "Become a member to deploy" : added ? "Added to My Bots" : "Add to My Bots"}
    </button>
  );
}
