"use client";

import { useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";

/**
 * Fire a signal by hand instead of waiting for TradingView. Runs the exact same
 * fan-out the webhook does, so what you see here is what a real alert would do.
 *
 * A dispatch that would spend real money is confirmed first: the server answers
 * 409 with how many members have armed live trading, and nothing is sent until
 * that is acknowledged.
 */

type Action = "enterLong" | "enterShort" | "exit";

type FanOutSummary = {
  signalId: string;
  liveDeployments: number;
  placed: string[];
  skipped: { userBotId: string; reason: string }[];
  failed: { userBotId: string; message: string }[];
  synced: number;
  closed: number;
};

const REQUESTS: Record<Action, { action: "enter" | "exit"; side?: "long" | "short" }> = {
  enterLong: { action: "enter", side: "long" },
  enterShort: { action: "enter", side: "short" },
  exit: { action: "exit" },
};

const LABELS: Record<Action, string> = { enterLong: "Enter Long", enterShort: "Enter Short", exit: "Exit All" };

/** Turn a `fanout.skip.<reason>` slug into something an admin can act on. */
const SKIP_REASONS: Record<string, string> = {
  noExchangeChosen: "no execution exchange chosen",
  exchangeNotWired: "exchange not wired for trading",
  noConnection: "no exchange API key connected",
  notReady: "deployment not fully configured",
  liveNotArmed: "live trading not armed (real funds protected)",
  positionAlreadyOpen: "already holds an open position",
};

export function BotExecutionPanel({ botId, botName }: { botId: string; botName: string }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [summary, setSummary] = useState<FanOutSummary | null>(null);
  const [confirming, setConfirming] = useState<{ action: Action; liveDeployments: number } | null>(null);

  async function dispatch(action: Action, confirmLive = false) {
    setBusy(action);
    setNotice(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/admin/bots/${botId}/dispatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...REQUESTS[action], ...(confirmLive ? { confirmLive: true } : {}) }),
      });
      const data = await res.json();

      if (res.status === 409 && data.requiresConfirmation) {
        setConfirming({ action, liveDeployments: data.liveDeployments });
        return;
      }
      // Any resolved outcome (success or a non-confirmation error) closes the
      // confirm box. It must NOT be cleared in `finally`, which also runs for the
      // 409 branch above and would shut the box the same tick it opened.
      setConfirming(null);
      if (!res.ok) {
        setNotice({ type: "error", message: data.error ?? "Dispatch failed" });
        return;
      }

      setSummary(data as FanOutSummary);
      const { placed, failed, closed, synced } = data as FanOutSummary;
      setNotice({
        type: failed.length ? "error" : "success",
        message:
          action === "exit"
            ? `Exit sent — ${closed} position${closed === 1 ? "" : "s"} closed, ${synced} checked.`
            : `${LABELS[action]} sent — ${placed.length} position${placed.length === 1 ? "" : "s"} opened.`,
      });
    } catch {
      setConfirming(null);
      setNotice({ type: "error", message: "Couldn't reach the server." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminCard
      title="Run a signal"
      subtitle={`Fires the same pipeline a TradingView alert would, for every member running ${botName}.`}
    >
      <div className="flex flex-wrap gap-2">
        {(["enterLong", "enterShort", "exit"] as Action[]).map((action) => (
          <button
            key={action}
            type="button"
            disabled={busy !== null}
            onClick={() => dispatch(action)}
            className={cn(
              "inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              action === "enterLong" && "border-success/40 text-success hover:bg-success/10",
              action === "enterShort" && "border-[#D2031E]/40 text-[#D2031E] hover:bg-[#D2031E]/10",
              action === "exit" && "border-line text-white hover:bg-white/5",
            )}
          >
            {busy === action ? "Sending…" : LABELS[action]}
          </button>
        ))}
      </div>

      {confirming && (
        <div className="flex flex-col gap-3 rounded-xl border border-[#D2031E]/40 bg-[#D2031E]/10 p-4">
          <p className="text-sm font-semibold text-[#D2031E]">Real funds will be traded</p>
          <p className="text-xs leading-[18px] text-white">
            {confirming.liveDeployments === 1 ? "1 member has" : `${confirming.liveDeployments} members have`} armed live
            trading on this bot. Sending <strong>{LABELS[confirming.action]}</strong> will place real orders on their
            exchange accounts with their own money.
          </p>
          <p className="text-[11px] leading-4 text-muted">
            Exits are never gated — closing a position reduces exposure.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => dispatch(confirming.action, true)}
              className="inline-flex h-9 items-center rounded-xl bg-[#D2031E] px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              Yes — trade real money
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="inline-flex h-9 items-center rounded-xl border border-line px-4 text-xs font-semibold text-white transition-colors hover:bg-white/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {notice && <Notice notice={notice} />}

      {summary && (summary.skipped.length > 0 || summary.failed.length > 0) && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-background p-4">
          {summary.skipped.length > 0 && (
            <>
              <p className="text-xs font-semibold text-muted">Skipped ({summary.skipped.length})</p>
              <ul className="flex flex-col gap-1">
                {summary.skipped.map((skip) => (
                  <li key={skip.userBotId} className="text-xs text-muted">
                    <span className="font-mono text-white/70">{skip.userBotId.slice(0, 8)}…</span>{" "}
                    {SKIP_REASONS[skip.reason] ?? skip.reason}
                  </li>
                ))}
              </ul>
            </>
          )}
          {summary.failed.length > 0 && (
            <>
              <p className="mt-2 text-xs font-semibold text-[#D2031E]">Failed ({summary.failed.length})</p>
              <ul className="flex flex-col gap-1">
                {summary.failed.map((failure) => (
                  <li key={failure.userBotId} className="text-xs text-[#D2031E]">
                    <span className="font-mono text-white/70">{failure.userBotId.slice(0, 8)}…</span> {failure.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </AdminCard>
  );
}
