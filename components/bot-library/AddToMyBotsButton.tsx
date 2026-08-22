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
 *  - member    → persists the add/remove to "My Bots" (optimistic, with revert).
 *
 * Guests can browse bot profiles read-only but can't deploy until they're members.
 */
export function AddToMyBotsButton({
  botId,
  authed,
  canDeploy,
  initialAdded = false,
}: {
  botId: string;
  /** Whether the viewer is signed in at all. */
  authed: boolean;
  /** Whether the viewer may actually deploy (member/admin). */
  canDeploy: boolean;
  /** Whether this bot is already in the member's My Bots. */
  initialAdded?: boolean;
}) {
  const router = useRouter();
  const [added, setAdded] = useState(initialAdded);
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!authed) {
      router.push(`/login?next=${encodeURIComponent(`/bot-library/${botId}`)}`);
      return;
    }
    if (!canDeploy) {
      // Signed-in guest: deploying needs a membership.
      router.push("/billing?gated=1");
      return;
    }
    if (pending) return;

    const next = !added;
    setAdded(next); // optimistic
    setPending(true);
    try {
      const res = next
        ? await fetch("/api/my-bots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ botId }),
          })
        : await fetch(`/api/my-bots/${botId}`, { method: "DELETE" });
      if (!res.ok) {
        setAdded(!next); // revert
        return;
      }
      router.refresh(); // keep My Bots / counts in sync
    } catch {
      setAdded(!next); // revert
    } finally {
      setPending(false);
    }
  }

  // Signed-in guests see a "members only" affordance instead of the add toggle.
  const locked = authed && !canDeploy;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-pressed={added}
      title={locked ? "Deploying bots needs access granted by an admin" : undefined}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors disabled:opacity-70",
        locked
          ? "border border-line bg-surface text-muted hover:border-accent/40 hover:text-white"
          : added
            ? "border border-success/40 bg-success/10 text-success"
            : "bg-accent text-[#06141a] hover:opacity-90",
      )}
    >
      {locked ? <LockIcon /> : added ? <CheckIcon /> : <PlusIcon />}
      {locked ? "Request access to deploy" : added ? "Added to My Bots" : "Add to My Bots"}
    </button>
  );
}
