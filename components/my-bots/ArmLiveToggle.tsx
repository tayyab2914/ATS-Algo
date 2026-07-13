"use client";

import { useState } from "react";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";

/**
 * The member's half of the live-money gate.
 *
 * A signal arrives from a webhook, so nobody is present to confirm a trade. A live
 * exchange key therefore does nothing until the member has deliberately armed this
 * deployment. Disarming is instant and needs no confirmation — like an exit, it
 * only ever reduces risk.
 *
 * Never shown for a paper key: there is nothing to protect.
 */
export function ArmLiveToggle({ botId, initialArmed }: { botId: string; initialArmed: boolean }) {
  const [armed, setArmed] = useState(initialArmed);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function commit(next: boolean) {
    setBusy(true);
    setNotice(null);
    const previous = armed;
    setArmed(next); // optimistic — the switch should feel immediate
    try {
      const res = await fetch(`/api/my-bots/${botId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ liveArmed: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setArmed(previous);
        setNotice({ type: "error", message: data.error ?? "Couldn't update live trading" });
        return;
      }
      setNotice({
        type: next ? "success" : "info",
        message: next ? "Live trading armed. Signals will place real orders." : "Live trading disarmed. No real orders will be placed.",
      });
    } catch {
      setArmed(previous);
      setNotice({ type: "error", message: "Couldn't reach the server." });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[#D2031E]/30 bg-[#D2031E]/5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-white">Live trading</h2>
          <p className="text-xs leading-[18px] text-muted">
            Your connected key trades <strong className="text-white">real funds</strong>. Signals are ignored until you
            arm this bot.
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold",
            armed ? "bg-[#D2031E]/15 text-[#D2031E]" : "bg-white/5 text-muted",
          )}
        >
          {armed ? "Armed — real money" : "Disarmed"}
        </span>
      </div>

      {notice && <Notice notice={notice} />}

      {confirming ? (
        <div className="flex flex-col gap-3 rounded-xl border border-[#D2031E]/40 bg-[#D2031E]/10 p-4">
          <p className="text-xs leading-[18px] text-white">
            Arming means the next signal for this bot places a <strong>real order with your own money</strong>, without
            asking again. Make sure your capital per trade and exchange key are what you intend.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => commit(true)}
              className="inline-flex h-9 items-center rounded-xl bg-[#D2031E] px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Arming…" : "Arm live trading"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex h-9 items-center rounded-xl border border-line px-4 text-xs font-semibold text-white transition-colors hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => (armed ? commit(false) : setConfirming(true))}
          className={cn(
            "inline-flex h-10 w-fit items-center rounded-xl border px-4 text-sm font-semibold transition-colors disabled:opacity-50",
            armed
              ? "border-line text-white hover:bg-white/5"
              : "border-[#D2031E]/50 text-[#D2031E] hover:bg-[#D2031E]/10",
          )}
        >
          {busy ? "Saving…" : armed ? "Disarm" : "Arm live trading"}
        </button>
      )}
    </section>
  );
}
