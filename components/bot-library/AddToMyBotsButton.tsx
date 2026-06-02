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

/**
 * "Add to My Bots" CTA. Signed-in users get an optimistic added/added-back
 * toggle; guests are routed to login (with a return path) since the action
 * needs an account.
 */
export function AddToMyBotsButton({ slug, authed }: { slug: string; authed: boolean }) {
  const router = useRouter();
  const [added, setAdded] = useState(false);

  function handleClick() {
    if (!authed) {
      router.push(`/login?next=${encodeURIComponent(`/bot-library/${slug}`)}`);
      return;
    }
    setAdded((v) => !v);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={added}
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors",
        added
          ? "border border-success/40 bg-success/10 text-success"
          : "bg-accent text-[#06141a] hover:opacity-90",
      )}
    >
      {added ? <CheckIcon /> : <PlusIcon />}
      {added ? "Added to My Bots" : "Add to My Bots"}
    </button>
  );
}
