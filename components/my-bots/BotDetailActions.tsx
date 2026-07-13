"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { botReadiness } from "@/lib/my-bots/readiness";

/**
 * Top-right action cluster on a bot's detail page. Pause and Stop both flip the
 * deployment to Non-Active (there is no live execution process to distinguish
 * them yet); an idle bot instead offers Activate — but only once the deployment
 * is configured (capital per trade + a connected key for the bot's exchange).
 * "Bot Setting" always links to the settings screen.
 */
export function BotDetailActions({
  botId,
  active,
  exchanges,
  chosen,
  connected,
  capitalPerTrade,
  allocationType,
  allocatedCapital,
}: {
  botId: string;
  active: boolean;
  exchanges: string[];
  chosen: string | null;
  connected: boolean;
  capitalPerTrade: number;
  allocationType: "FIXED" | "PERCENTAGE";
  allocatedCapital: number;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"pause" | "stop" | "activate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readiness = botReadiness({ exchanges, chosen, connected, capitalPerTrade, allocationType, allocatedCapital });

  async function setActive(next: boolean, kind: "pause" | "stop" | "activate") {
    setPending(kind);
    setError(null);
    try {
      const res = await fetch(`/api/my-bots/${botId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong. Try again.");
        setPending(null);
      }
    } catch {
      setError("Network error. Please try again.");
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
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
        ) : readiness.ready ? (
          <button
            type="button"
            onClick={() => setActive(true, "activate")}
            disabled={pending !== null}
            className="inline-flex h-10 items-center justify-center rounded-2xl bg-success px-5 text-sm font-semibold text-[#06141a] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending === "activate" ? "Activating…" : "Activate Bot"}
          </button>
        ) : (
          <button
            type="button"
            disabled
            title={readiness.missing.join("; ")}
            className="inline-flex h-10 cursor-not-allowed items-center justify-center rounded-2xl bg-success/40 px-5 text-sm font-semibold text-[#06141a]/70"
          >
            Activate Bot
          </button>
        )}
        <Link
          href={`/my-bots/${botId}/settings`}
          className="inline-flex h-10 items-center justify-center rounded-2xl bg-accent px-5 text-sm font-semibold text-[#06141a] transition-transform hover:-translate-y-0.5"
        >
          Bot Setting
        </Link>
      </div>
      {!active && !readiness.ready && (
        <p className="text-xs text-[#f5a623]">⚠ Before activating: {readiness.missing.join(" · ")}.</p>
      )}
      {error && <p className="text-xs text-[#D2031E]">{error}</p>}
    </div>
  );
}
