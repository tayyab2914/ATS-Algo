"use client";

import { useMemo, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { CopyField } from "@/components/admin/CopyField";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";
import {
  BUILT_IN_WORDS,
  COMMAND_LABEL,
  DEFAULT_ACTION_FIELD,
  payloadFor,
  SIGNAL_COMMANDS,
  signalMapError,
  type SignalCommand,
  type SignalMap,
} from "@/lib/execution/signal-map";

/**
 * JSON signal settings — the words this bot's TradingView alerts use.
 *
 * The ATS indicator is driven through "Any alert() function call", so TradingView
 * posts the indicator's OWN message and the wording is chosen in the indicator, not
 * here. The indicator now carries separate JSON fields for the long and the short
 * signal, which is exactly the case the old fixed vocabulary could not express. So
 * this panel does two things: it teaches the webhook the words the indicator sends,
 * and it prints the matching body to paste back into the indicator.
 *
 * Adding a word never removes one. `enter_long` / `enter_short` / `exit` / `tp1…10`
 * are accepted on every bot forever, so an alert that is working right now keeps
 * working no matter what is typed here — which is the property that makes this safe
 * to expose at all.
 */

const PLACEHOLDER = "<set-SIGNAL_SECRET-on-the-server>";

/** How many take-profit rows to show: the bot's own rungs, floored at 6 for the reference indicator. */
const tpRowCount = (rungs: number) => Math.min(10, Math.max(6, rungs));

export type SignalSettingsProps = {
  botId: string;
  /** `SIGNAL_SECRET` as configured on the server, or null if it is unset. */
  secret: string | null;
  /** Stored mapping, already parsed. Empty object = built-in vocabulary only. */
  initial: SignalMap;
  /** Take-profit rungs in the profile this bot trades, so the panel lists the right ones. */
  tpRungs: number;
};

export function SignalSettings({ botId, secret, initial, tpRungs }: SignalSettingsProps) {
  const token = secret ?? PLACEHOLDER;
  const [field, setField] = useState(initial.field ?? DEFAULT_ACTION_FIELD);
  // One comma-separated box per command, which is how an admin thinks about
  // "the words my indicator sends" — split on save, never on every keystroke.
  const [words, setWords] = useState<Record<string, string>>(() => boxesFrom(initial));
  // What is currently STORED, as boxes. Advanced on a successful save so the button
  // goes quiet again — comparing against the `initial` prop instead would leave
  // "Save" lit forever, since that prop is fixed until the page is re-rendered.
  const [saved, setSaved] = useState(() => ({ field: initial.field ?? DEFAULT_ACTION_FIELD, words: boxesFrom(initial) }));
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);

  const draft: SignalMap = useMemo(
    () => ({
      field: field.trim() || DEFAULT_ACTION_FIELD,
      words: Object.fromEntries(
        SIGNAL_COMMANDS.map((c) => [c, splitWords(words[c] ?? "")]),
      ) as Partial<Record<SignalCommand, string[]>>,
    }),
    [field, words],
  );

  // The same function the API runs, so a collision is caught next to the box that
  // caused it rather than as a 422 after the round trip.
  const error = useMemo(() => signalMapError(draft), [draft]);

  const maxTp = tpRowCount(tpRungs);
  const rows = SIGNAL_COMMANDS.filter((c) => !c.startsWith("tp") || Number(c.slice(2)) <= maxTp);

  const dirty =
    saved.field !== (field.trim() || DEFAULT_ACTION_FIELD) ||
    SIGNAL_COMMANDS.some((c) => splitWords(saved.words[c] ?? "").join(", ") !== splitWords(words[c] ?? "").join(", "));

  async function save() {
    if (error) {
      setNotice({ type: "error", message: error });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/bots/${botId}/signals`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Couldn't save the signal settings." });
        return;
      }
      setSaved({ field: draft.field ?? DEFAULT_ACTION_FIELD, words: { ...words } });
      setNotice({ type: "success", message: "Signal settings saved. The webhook accepts these words from the next alert on." });
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setField(DEFAULT_ACTION_FIELD);
    setWords(Object.fromEntries(SIGNAL_COMMANDS.map((c) => [c, ""])));
    setNotice(null);
  }

  return (
    <AdminCard
      title="JSON signal settings"
      subtitle="Teach the webhook the words this bot's indicator sends, and copy the matching body into the indicator's Long and Short fields."
    >
      <div className="flex flex-col gap-5">
        {notice && <Notice notice={notice} />}

        <label className="flex max-w-xs flex-col gap-2">
          <span className="text-xs leading-[18px] text-muted">Command key — the JSON field the command travels under</span>
          <input
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder={DEFAULT_ACTION_FIELD}
            className="h-[42px] w-full rounded-lg border border-line bg-background px-3 font-mono text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none"
          />
          <span className="text-xs text-muted">
            Defaults to <code className="text-white">{DEFAULT_ACTION_FIELD}</code>. <code className="text-white">{DEFAULT_ACTION_FIELD}</code> keeps working
            as a fallback whatever you set here.
          </span>
        </label>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-xs font-semibold text-muted">
                <th className="px-2 py-2">Command</th>
                <th className="px-2 py-2">Words your indicator sends</th>
                <th className="px-2 py-2">Always accepted</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((command) => (
                <tr key={command} className="border-b border-line/60 last:border-0">
                  <td className="w-40 px-2 py-2">
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        command === "enter_long"
                          ? "text-success"
                          : command === "enter_short"
                            ? "text-[#D2031E]"
                            : "text-white",
                      )}
                    >
                      {COMMAND_LABEL[command]}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={words[command] ?? ""}
                      onChange={(e) => setWords((w) => ({ ...w, [command]: e.target.value }))}
                      placeholder="comma-separated — leave empty to use the default"
                      className="h-[38px] w-full rounded-lg border border-line bg-background px-3 font-mono text-[13px] text-white placeholder:font-sans placeholder:text-muted focus:border-accent/60 focus:outline-none"
                    />
                  </td>
                  <td className="w-44 px-2 py-2 font-mono text-[11px] text-muted">{BUILT_IN_WORDS[command].join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <p className="text-xs text-[#D2031E]">{error}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-white"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending || Boolean(error) || !dirty}
            className="rounded-2xl bg-accent px-5 py-2 text-sm font-semibold text-[#121212] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save signal settings"}
          </button>
        </div>

        {/* What to paste — generated from the mapping above so the two can't drift. */}
        <div className="flex flex-col gap-3 border-t border-line pt-5">
          <span className="text-xs font-semibold text-muted">
            Alert bodies for this bot {error ? "(fix the mapping above first)" : "— paste into the indicator"}
          </span>
          {rows.map((command) => (
            <CopyField
              key={command}
              label={`${COMMAND_LABEL[command]} JSON`}
              value={error ? "—" : payloadFor(draft, command, token)}
            />
          ))}
        </div>

        <p className={cn("text-[11px] leading-4", secret ? "text-muted" : "text-[#D2031E]")}>
          Paste each body verbatim — there is nothing to fill in and no placeholder to substitute. Long and short are
          separate alerts, so the direction rides in the command; the entry price is read from the exchange when the
          order is placed. A redelivered alert is dropped for five minutes, so a retry cannot reverse an open position.
        </p>
      </div>
    </AdminCard>
  );
}

/** A stored mapping as the panel's text boxes: one comma-separated string per command. */
function boxesFrom(map: SignalMap): Record<string, string> {
  return Object.fromEntries(SIGNAL_COMMANDS.map((c) => [c, (map.words?.[c] ?? []).join(", ")]));
}

/** "LONG, buy_now" → ["LONG", "buy_now"]. Commas and newlines both separate. */
function splitWords(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
}
