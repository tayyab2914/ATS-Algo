"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Top-right action cluster on a bot's detail page. Pause and Stop both flip the
 * deployment to Non-Active (there is no live execution process to distinguish
 * them yet); an idle bot instead offers Activate. "Bot Setting" always links to
 * the settings screen.
 */
export function BotDetailActions({ botId, active }: { botId: string; active: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<"pause" | "stop" | "activate" | null>(null);

  async function setActive(next: boolean, kind: "pause" | "stop" | "activate") {
    setPending(kind);
    try {
      const res = await fetch(`/api/my-bots/${botId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (res.ok) router.refresh();
      else setPending(null);
    } catch {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {active ? (
        <>
          <button
            type="button"
            onClick={() => setActive(false, "pause")}
            disabled={pending !== null}
            className="inline-flex h-10 items-center justify-center rounded-2xl border border-accent px-5 text-sm font-semibold text-accent transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending === "pause" ? "Pausing…" : "Pause Bot"}
          </button>
          <button
            type="button"
            onClick={() => setActive(false, "stop")}
            disabled={pending !== null}
            className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#D2031E] px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending === "stop" ? "Stopping…" : "Stop Bot"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setActive(true, "activate")}
          disabled={pending !== null}
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-success px-5 text-sm font-semibold text-[#06141a] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending === "activate" ? "Activating…" : "Activate Bot"}
        </button>
      )}
      <Link
        href={`/my-bots/${botId}/settings`}
        className={cn(
          "inline-flex h-10 items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#06141a] transition-transform hover:-translate-y-0.5",
        )}
      >
        Bot Setting
      </Link>
    </div>
  );
}
