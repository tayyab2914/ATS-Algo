"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { BacktestResults } from "@/components/admin/BacktestResults";
import { CheckIcon } from "@/components/admin/admin-icons";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { Switch } from "@/components/ui/Switch";
import { runBacktest, type BacktestResult, type BotConfig, type RiskClass } from "@/lib/backtest/engine";
import { cn } from "@/lib/cn";

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
  riskClass: RiskClass;
  status: "ACTIVE" | "DISABLED";
  csvFilename: string | null;
  config: BotConfig;
  csvText: string;
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
  const [riskClass, setRiskClass] = useState<RiskClass>(bot.riskClass);
  const [enabled, setEnabled] = useState(bot.status === "ACTIVE");
  const [statusPending, setStatusPending] = useState(false);

  const [config, setConfig] = useState<BotConfig>(bot.config);
  const [csvText, setCsvText] = useState(bot.csvText);
  const [csvFilename, setCsvFilename] = useState(bot.csvFilename ?? "");
  const [configChanged, setConfigChanged] = useState(false);
  const [csvChanged, setCsvChanged] = useState(false);

  // Show the current bot's metrics on load (lazy init) so changes are easy to
  // compare; the user re-runs after swapping a file.
  const [result, setResult] = useState<BacktestResult | null>(() => {
    try {
      return bot.csvText ? runBacktest(bot.config, bot.csvText) : null;
    } catch {
      return null;
    }
  });
  const [message, setMessage] = useState("");

  const jsonRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  // Any edited field counts as a change — including metadata-only edits like
  // switching the category, which previously left Save disabled with no reason.
  const dirty =
    name !== bot.name ||
    category !== bot.category ||
    timeframe !== bot.timeframe ||
    riskClass !== bot.riskClass ||
    configChanged ||
    csvChanged;
  // A fresh backtest is only required when the config or CSV changed; a
  // metadata-only edit can save against the existing (mount-time) metrics.
  const needsRerun = (configChanged || csvChanged) && !result;
  const saveDisabled = pending || !dirty || needsRerun || !message.trim();
  // Tell the admin exactly why Save is unavailable instead of showing a dead button.
  const saveHint = pending
    ? null
    : !dirty
      ? "No changes to save yet"
      : needsRerun
        ? "Re-run the backtest before saving"
        : !message.trim()
          ? "Add a change note to save"
          : null;

  async function onJsonPicked(file: File) {
    setNotice(null);
    try {
      const parsed = JSON.parse(await file.text()) as BotConfig;
      if (!parsed?.profiles?.balanced) {
        setNotice({ type: "error", message: "That JSON has no trading profiles (safe / balanced / aggressive)." });
        return;
      }
      setConfig(parsed);
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

  function runPreview() {
    setNotice(null);
    try {
      setResult(runBacktest(config, csvText));
    } catch {
      setNotice({ type: "error", message: "Backtest failed — check the CSV signal format." });
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
          riskClass,
          message: message.trim(),
          ...(configChanged ? { config } : {}),
          ...(csvChanged ? { csvText, csvFilename } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Couldn't save the bot." });
        return;
      }
      router.push("/admin/bots");
      router.refresh();
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
            className="self-start rounded-2xl border border-accent px-5 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/10"
          >
            Run Backtest
          </button>
          {result ? (
            <BacktestResults name={name} timeframe={timeframe} riskClass={riskClass} result={result} />
          ) : (
            <p className="text-xs text-muted">Run the backtest to preview the updated metrics before saving.</p>
          )}
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
