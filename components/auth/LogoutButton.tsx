"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Signs the user out via the API, then returns to `redirectTo` (default home "/"). */
export function LogoutButton({
  className,
  redirectTo = "/",
}: {
  className?: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push(redirectTo);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={pending}
      className={cn(
        "flex h-11 items-center justify-center rounded-xl border border-line px-5 text-sm font-medium text-muted transition-colors hover:text-white disabled:opacity-60",
        className,
      )}
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
