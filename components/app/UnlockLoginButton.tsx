"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * "Login to get full access" CTA for the {@link LockedOverlay}. Before sending
 * the visitor to login it clears any session cookie, which matters for a user
 * whose access was just revoked (suspended, banned, or force-logged-out): their
 * old JWT still looks valid to the edge proxy, so without clearing it the proxy
 * would bounce them straight back off `/login`. For a true guest with no cookie
 * the logout call is a harmless no-op.
 */
export function UnlockLoginButton({ href }: { href: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore — navigate regardless so the user is never trapped.
    }
    router.push(href);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#06141a] transition-transform hover:-translate-y-0.5 disabled:opacity-70"
    >
      {pending ? "Redirecting…" : "Login to get full access"}
    </button>
  );
}
