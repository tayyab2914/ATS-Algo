"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { BacktestResults } from "@/components/admin/BacktestResults";
import { LadderPreview } from "@/components/admin/LadderPreview";
import { parseTightenInput, StopLadderField } from "@/components/admin/StopLadderField";
import { CheckIcon } from "@/components/admin/admin-icons";
import { ExchangeMultiSelect } from "@/components/admin/ExchangeMultiSelect";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { Switch } from "@/components/ui/Switch";
import { configRatchetPct, withRatchetPct } from "@/lib/bot-config";
import { runBacktest, type BacktestResult, type BotConfig, type RiskClass } from "@/lib/backtest/engine";
import { cn } from "@/lib/cn";
import { botConfigError } from "@/lib/validation";

const RISKS: { value: RiskClass; label: string }[] = [
  { value: "LOW", label: "Low (safe)" },
  { value: "MEDIUM", label: "Medium (balanced)" },
  { value: "HIGH", label: "High (aggressive)" },
];

const inputCls =
  "h-[42px] w-full rounded-lg border border-line bg-background px-3 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none";
const labelCls = "text-xs leading-[18px] text-muted";

export type BotEditorData = {
  id: string;
  name: string;
  category: string;
  timeframe: string;
  exchanges: string[];
  riskClass: RiskClass;
  status: "ACTIVE" | "DISABLED";
  csvFilename: string | null;
  config: BotConfig;
  /**
   * The metrics already stored on the bot row. Shown on mount instead of
   * re-simulating the CSV — they're the output of the same backtest, saved by
   * the route that last touched the config or signals, so they can't drift.
   */
  initialResult: BacktestResult | null;
};

export function BotEditor({ bot, categories }: { bot: BotEditorData; categories: string[] }) {
  const router = useRouter();
  // Always include the bot's current category, even if it was since renamed/removed.
  const categoryOptions = categories.includes(bot.category) ? categories : [bot.category, ...categories];
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);

  const [name, setName] = useState(bot.name);
  const [category, setCategory] = useState(bot.category);
  const [timeframe, setTimeframe] = useState(bot.timeframe);
  const [exchanges, setExchanges] = useState<string[]>(bot.exchanges);
  const [riskClass, setRiskClass] = useState<RiskClass>(bot.riskClass);
  const [enabled, setEnabled] = useState(bot.status === "ACTIVE");
  const [statusPending, setStatusPending] = useState(false);

  const [config, setConfig] = useState<BotConfig>(bot.config);
  // Empty until the admin picks a new file or a re-run pulls the stored one —
  // the bot's CSV is no longer shipped with the page. See `loadCsv`.
  const [csvText, setCsvText] = useState("");
  const [csvFilename, setCsvFilename] = useState(bot.csvFilename ?? "");
  const [configChanged, setConfigChanged] = useState(false);
  const [csvChanged, setCsvChanged] = useState(false);
  // Editable on its own, without re-uploading the JSON — the whole point of moving
  // the ladder out of the file.
  const [tightenPct, setTightenPct] = useState(() => String(configRatchetPct(bot.config) ?? ""));

  // Show the current bot's metrics on load so changes are easy to compare; the
  // user re-runs after swapping a file. These come straight off the row — the
  // editor used to re-run the whole backtest here during render, which blocked
  // hydration and duplicated work the save route had already done.
  const [result, setResult] = useState<BacktestResult | null>(bot.initialResult);
  const [previewPending, setPreviewPending] = useState(false);
  const [message, setMessage] = useState("");

  const jsonRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const tighten = useMemo(() => parseTightenInput(tightenPct), [tightenPct]);
  // Everything below reads the config WITH the ladder written in — preview,
  // validation and PATCH must all judge the same object. Memoised because these
  // ran on every keystroke in any field, not just the ladder's.
  const effectiveConfig = useMemo(() => withRatchetPct(config, tighten.value), [config, tighten.value]);
  const ladderError = useMemo(
    () => tighten.error ?? botConfigError(effectiveConfig, riskClass),
    [tighten.error, effectiveConfig, riskClass],
  );
  const tightenChanged = tighten.value !== configRatchetPct(bot.config);

  // Any edited field counts as a change — including metadata-only edits like
  // switching the category, which previously left Save disabled with no reason.
  const dirty =
    name !== bot.name ||
    category !== bot.category ||
    timeframe !== bot.timeframe ||
    exchanges.length !== bot.exchanges.length ||
    exchanges.some((e) => !bot.exchanges.includes(e)) ||
    riskClass !== bot.riskClass ||
    configChanged ||
    tightenChanged ||
    csvChanged;
  // A fresh backtest is only required when the config or CSV changed; a
  // metadata-only edit can save against the existing (mount-time) metrics.
  // `tightenChanged` is deliberately NOT here: the backtest doesn't model the stop
  // ladder at all, so a re-run would return byte-identical metrics and the prompt
  // would be a lie. Change that the day `simulateTrade` reads `sl_tighten_pct`.
  const needsRerun = (configChanged || csvChanged) && !result;
  const saveDisabled = pending || !dirty || needsRerun || Boolean(ladderError) || !message.trim();
  // Tell the admin exactly why Save is unavailable instead of showing a dead button.
  const saveHint = pending
    ? null
    : !dirty
      ? "No changes to save yet"
      : ladderError
        ? "Fix the stop ladder to save"
        : needsRerun
          ? "Re-run the backtest before saving"
          : !message.trim()
            ? "Add a change note to save"
            : null;

  async function onJsonPicked(file: File) {
    setNotice(null);
    try {
      const parsed = JSON.parse(await file.text()) as BotConfig;
      // Same rules the API enforces, so a bad ladder is caught before upload.
      const configError = botConfigError(parsed, riskClass);
      if (configError) {
        setNotice({ type: "error", message: configError });
        return;
      }
      setConfig(parsed);
      // Follow the new file's ladder if it carries one, so a replacement config's
      // own tuning wins over whatever was left in the box from the old one.
      setTightenPct(String(configRatchetPct(parsed) ?? ""));
      setConfigChanged(true);
      setResult(null); // force a re-run before saving
    } catch {
      setNotice({ type: "error", message: "Couldn't parse that file as JSON." });
    }
  }

  async function onCsvPicked(file: File) {
    setNotice(null);
    const text = await file.text();
    if (!text.trim()) {
      setNotice({ type: "error", message: "That CSV looks empty." });
      return;
    }
    setCsvText(text);
    setCsvFilename(file.name);
    setCsvChanged(true);
    setResult(null); // force a re-run before saving
  }

  /**
   * The bot's signals aren't in the page payload — pull them the first time a
   * re-run needs them, and keep them for subsequent runs. A freshly picked file
   * is already in state, so this only ever hits the network for the stored CSV.
   */
  async function loadCsv(): Promise<string> {
    if (csvText) return csvText;
    const res = await fetch(`/api/admin/bots/${bot.id}/csv`);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "Couldn't load this bot's signal CSV.");
    }
    const text = await res.text();
    setCsvText(text);
    return text;
  }

  async function runPreview() {
    setNotice(null);
    setPreviewPending(true);
    try {
      let csv: string;
      try {
        csv = await loadCsv();
      } catch (error) {
        setNotice({
          type: "error",
          message: error instanceof Error ? error.message : "Couldn't load this bot's signal CSV.",
        });
        return;
      }
      try {
        setResult(runBacktest(effectiveConfig, csv));
      } catch {
        setNotice({ type: "error", message: "Backtest failed — check the CSV signal format." });
      }
    } finally {
      setPreviewPending(false);
    }
  }

  // Enable/disable saves on its own — no change note, no history entry.
  async function toggleStatus(next: boolean) {
    const prev = enabled;
    setEnabled(next); // optimistic
    setStatusPending(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/bots/${bot.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next ? "ACTIVE" : "DISABLED" }),
      });
      if (!res.ok) {
        setEnabled(prev); // revert
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setNotice({ type: "error", message: data?.error ?? "Couldn't update the bot's status." });
        return;
      }
      setNotice({ type: "success", message: next ? "Bot enabled." : "Bot disabled." });
      router.refresh();
    } catch {
      setEnabled(prev); // revert
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setStatusPending(false);
    }
  }

  async function save() {
    if (!message.trim()) {
      setNotice({ type: "error", message: "Add a short note describing what changed." });
      return;
    }
    if (ladderError) {
      setNotice({ type: "error", message: ladderError });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/bots/${bot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category,
          timeframe,
          exchanges,
          riskClass,
          message: message.trim(),
          // Retuning the ladder alone still rewrites the config — it lives inside it.
          ...(configChanged || tightenChanged ? { config: effectiveConfig } : {}),
          ...(csvChanged ? { csvText, csvFilename } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Couldn't save the bot." });
        return;
      }
      // `push` already refetches the list route's RSC payload — a `refresh` here
      // rendered the whole page a second time for nothing.
      router.push("/admin/bots");
    } catch {
      setNotice({ type: "error", message: "Network error. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <AdminCard title={`Edit ${bot.name}`} subtitle="Swap the config or signals, re-run the backtest, then save with a note on what changed.">
      <div className="flex flex-col gap-6">
        {notice && <Notice notice={notice} />}

        {/* Files */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <ReplaceTile
            label="Config (JSON)"
            hint={configChanged ? `New config loaded${config.name ? `: ${config.name}` : ""}` : "Keeping current config — upload to replace"}
            changed={configChanged}
            accept="application/json,.json"
            inputRef={jsonRef}
            onPick={onJsonPicked}
          />
          <ReplaceTile
            label="Signals (CSV)"
            hint={csvChanged ? `New CSV: ${csvFilename}` : csvFilename ? `Keeping current: ${csvFilename}` : "Keeping current signals — upload to replace"}
            changed={csvChanged}
            accept="text/csv,.csv"
            inputRef={csvRef}
            onPick={onCsvPicked}
          />
        </div>

        {/* Details */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-2">
            <span className={labelCls}>Bot Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-2">
            <span className={labelCls}>Timeframe</span>
            <input value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-2">
            <span className={labelCls}>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={cn(inputCls, "appearance-none pr-10")}>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-2 lg:col-span-2">
            <span className={labelCls}>Exchanges — allowed venues (users pick one)</span>
            <ExchangeMultiSelect value={exchanges} onChange={setExchanges} />
          </div>
          <label className="flex flex-col gap-2">
            <span className={labelCls}>Risk Class</span>
            <select value={riskClass} onChange={(e) => setRiskClass(e.target.value as RiskClass)} className={cn(inputCls, "appearance-none pr-10")}>
              {RISKS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
        </div>

        {/* Visibility — saves instantly, no change note / history entry. */}
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-line bg-background p-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-white">{enabled ? "Bot enabled" : "Bot disabled"}</span>
            <span className="text-xs text-muted">
              {enabled
                ? "Visible to users in the bot library. Toggling saves immediately."
                : "Hidden from users. Toggling saves immediately."}
            </span>
          </div>
          <Switch checked={enabled} onChange={toggleStatus} disabled={statusPending} ariaLabel="Enable or disable bot" />
        </div>

        {/* Backtest */}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={runPreview}
            disabled={previewPending}
            className="self-start rounded-2xl border border-accent px-5 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
          >
            {previewPending ? "Running…" : "Run Backtest"}
          </button>
          {result ? (
            <BacktestResults name={name} timeframe={timeframe} riskClass={riskClass} result={result} />
          ) : (
            <p className="text-xs text-muted">Run the backtest to preview the updated metrics before saving.</p>
          )}
        </div>

        {/* Progressive stop ladder — the field is the source of truth; the table is its consequence. */}
        <div className="flex flex-col gap-4 border-t border-line pt-6">
          <StopLadderField value={tightenPct} onChange={setTightenPct} error={ladderError} />
          <LadderPreview config={effectiveConfig} riskClass={riskClass} />
        </div>

        {/* Change message */}
        <label className="flex flex-col gap-2">
          <span className={labelCls}>What changed? — required, saved to the bot&apos;s history</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="e.g. Re-optimised TP ladder on fresh April–June signals; leverage 7→5 on balanced."
            className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none"
          />
        </label>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-line pt-4">
          <button
            type="button"
            onClick={() => router.push("/admin/bots")}
            disabled={pending}
            className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-white disabled:opacity-40"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {saveHint && <span className="text-xs text-muted">{saveHint}</span>}
            <button
              type="button"
              disabled={saveDisabled}
              onClick={save}
              className="rounded-2xl bg-accent px-5 py-2 text-sm font-semibold text-[#121212] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </AdminCard>
  );
}

function ReplaceTile({
  label,
  hint,
  changed,
  accept,
  inputRef,
  onPick,
}: {
  label: string;
  hint: string;
  changed: boolean;
  accept: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <span className={labelCls}>{label}</span>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
        className={cn(
          "flex items-center justify-between gap-4 rounded-2xl border border-dashed px-5 py-6 text-left transition-colors",
          dragging
            ? "border-accent bg-accent/10 ring-1 ring-accent/40"
            : changed
              ? "border-accent/50 bg-accent/5"
              : "border-line bg-background hover:border-accent/40",
        )}
      >
        <span className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-white">
            {dragging ? "Drop the file to replace" : changed ? "New file loaded" : "Click or drag to replace"}
          </span>
          <span className="text-xs text-muted">{hint}</span>
        </span>
        {changed && (
          <span className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-accent">
            <CheckIcon className="size-4" />
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
