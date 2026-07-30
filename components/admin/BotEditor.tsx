"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { BacktestResults } from "@/components/admin/BacktestResults";
import { LadderPreview } from "@/components/admin/LadderPreview";
import { LeverageField, parseLeverageInput } from "@/components/admin/LeverageField";
import { parseTightenInput, StopLadderField } from "@/components/admin/StopLadderField";
import { CheckIcon } from "@/components/admin/admin-icons";
import { ExchangeMultiSelect } from "@/components/admin/ExchangeMultiSelect";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { Switch } from "@/components/ui/Switch";
import { configRatchetPct, profileLeverage, withLeverage, withRatchetPct } from "@/lib/bot-config";
import { runBacktest, type BacktestResult, type BotConfig, type RiskClass } from "@/lib/backtest/engine";
import { cn } from "@/lib/cn";
import { botConfigError, ladderGeometryError } from "@/lib/validation";

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

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

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
  // Editable on their own, without re-uploading the JSON — the whole point of
  // moving the ladder and the leverage out of the file.
  const [tightenPct, setTightenPct] = useState(() => String(configRatchetPct(bot.config) ?? ""));
  const [leveragePct, setLeveragePct] = useState(() => String(profileLeverage(bot.config, bot.riskClass) ?? ""));

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
  const leverage = useMemo(() => parseLeverageInput(leveragePct), [leveragePct]);

  // The config as it would be STORED: the current config with this bot's ladder and
  // leverage written in. Preview, validation and the PATCH must all judge the same
  // object. Memoised because these ran on every keystroke in any field.
  const effectiveConfig = useMemo(() => {
    const withLadder = withRatchetPct(config, tighten.value);
    return leverage.value === null ? withLadder : withLeverage(withLadder, riskClass, leverage.value);
  }, [config, tighten.value, leverage.value, riskClass]);

  const storedTighten = configRatchetPct(bot.config);
  const storedLeverage = profileLeverage(bot.config, riskClass);
  const tightenChanged = tighten.value !== storedTighten;
  const leverageChanged = leverage.value !== null && leverage.value !== storedLeverage;

  /**
   * Why Save is unavailable — or null when it isn't.
   *
   * Scoped to what this save actually SENDS. A config uploaded here has to pass the
   * whole schema; a bot merely being renamed does not, and neither does the config
   * already sitting on the row. That distinction is the bug this file used to have:
   * `botConfigError` ran against the STORED config on mount, so any bot whose JSON
   * predates the current rules (no `fees` block, say) had Save permanently disabled
   * behind "Fix the stop ladder to save" — no matter what was edited. The server has
   * never re-validated stored configs, and now neither does this.
   */
  const blockingError = useMemo(() => {
    if (tighten.error) return tighten.error;
    if (leverage.error) return leverage.error;
    // A replacement file is new material — hold it to everything.
    if (configChanged) return botConfigError(effectiveConfig, riskClass);
    // An in-place retune is held to the ladder's geometry only, exactly like the API.
    if (tightenChanged || leverageChanged) return ladderGeometryError(effectiveConfig)?.message ?? null;
    return null;
  }, [tighten.error, leverage.error, configChanged, tightenChanged, leverageChanged, effectiveConfig, riskClass]);

  // Any edited field counts as a change — including metadata-only edits like
  // switching the category, which previously left Save disabled with no reason.
  const dirty =
    name !== bot.name ||
    category !== bot.category ||
    timeframe !== bot.timeframe ||
    !sameSet(exchanges, bot.exchanges) ||
    riskClass !== bot.riskClass ||
    configChanged ||
    tightenChanged ||
    leverageChanged ||
    csvChanged;

  // A stale preview is worth flagging, but it is NOT a save blocker: the PATCH route
  // re-runs the backtest server-side and stores that result, so the button used to
  // be held hostage to a preview whose output is thrown away. Worse, a bot with no
  // CSV on file could never satisfy it at all.
  const previewStale = (configChanged || csvChanged) && !result;
  const saveDisabled = pending || !dirty || Boolean(blockingError);
  // Tell the admin exactly why Save is unavailable instead of showing a dead button.
  const saveHint = pending
    ? null
    : !dirty
      ? "No changes to save yet"
      : blockingError
        ? "Fix the highlighted field to save"
        : previewStale
          ? "Saving will re-run the backtest"
          : null;

  /**
   * The change note, written for the admin when they leave the box empty.
   *
   * The note is what the bot's public history is made of, so it can't just be
   * dropped — but requiring it by hand made a one-word rename impossible to save.
   * Generating it keeps the history precise (more precise than most freehand notes)
   * and takes the requirement off the critical path.
   */
  function describeChanges(): string {
    const parts: string[] = [];
    if (name !== bot.name) parts.push(`renamed “${bot.name}” → “${name}”`);
    if (category !== bot.category) parts.push(`category ${bot.category} → ${category}`);
    if (timeframe !== bot.timeframe) parts.push(`timeframe ${bot.timeframe} → ${timeframe}`);
    if (!sameSet(exchanges, bot.exchanges))
      parts.push(`exchanges ${bot.exchanges.join(", ") || "none"} → ${exchanges.join(", ") || "none"}`);
    if (riskClass !== bot.riskClass) parts.push(`risk class ${bot.riskClass} → ${riskClass}`);
    if (leverageChanged) parts.push(`leverage ${storedLeverage ?? "—"}x → ${leverage.value}x`);
    if (tightenChanged) parts.push(`stop ladder ${storedTighten ?? "off"} → ${tighten.value ?? "off"}`);
    if (configChanged) parts.push("replaced the config JSON");
    if (csvChanged) parts.push(`replaced the signal CSV${csvFilename ? ` (${csvFilename})` : ""}`);
    if (parts.length === 0) return "Saved with no field changes";
    return `${parts[0][0].toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? `; ${parts.slice(1).join("; ")}` : ""}`;
  }

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
      // Follow the new file's ladder and leverage if it carries them, so a
      // replacement config's own tuning wins over whatever was left in the boxes
      // from the old one.
      setTightenPct(String(configRatchetPct(parsed) ?? ""));
      setLeveragePct(String(profileLeverage(parsed, riskClass) ?? ""));
      setConfigChanged(true);
      setResult(null); // the shown metrics are now stale
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
    setResult(null); // the shown metrics are now stale
  }

  /** Risk class selects a different profile, so the leverage box has to follow it. */
  function onRiskChanged(next: RiskClass) {
    setRiskClass(next);
    setLeveragePct(String(profileLeverage(config, next) ?? ""));
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
    if (blockingError) {
      setNotice({ type: "error", message: blockingError });
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
          message: message.trim() || describeChanges(),
          // Only a replacement file ships a whole config. The ladder and leverage
          // travel as their own fields so the server can apply them to the config
          // already on the row — which is what lets a bot whose stored JSON predates
          // the current schema still be retuned.
          ...(configChanged ? { config } : {}),
          ...(tightenChanged ? { tightenPct: tighten.value } : {}),
          ...(leverageChanged ? { leverage: leverage.value } : {}),
          ...(csvChanged ? { csvText, csvFilename } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; warning?: string } | null;
      if (!res.ok) {
        setNotice({ type: "error", message: data?.error ?? "Couldn't save the bot." });
        return;
      }
      if (data?.warning) {
        // Saved, but something the admin should know about — keep them on the page
        // to read it rather than bouncing to the list.
        setNotice({ type: "success", message: data.warning });
        router.refresh();
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
    <AdminCard title={`Edit ${bot.name}`} subtitle="Change anything here and save — the backtest is re-run on the server whenever it needs to be.">
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
            <select value={riskClass} onChange={(e) => onRiskChanged(e.target.value as RiskClass)} className={cn(inputCls, "appearance-none pr-10")}>
              {RISKS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <LeverageField
            value={leveragePct}
            onChange={setLeveragePct}
            stored={storedLeverage}
            riskClass={riskClass}
            error={leverage.error}
          />
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
          {previewStale && (
            <p className="text-xs text-accent">
              These metrics are from before your change. Run the backtest to preview the new ones — saving recomputes and stores them either way.
            </p>
          )}
          {result ? (
            <BacktestResults name={name} timeframe={timeframe} riskClass={riskClass} result={result} />
          ) : (
            <p className="text-xs text-muted">Run the backtest to preview the updated metrics before saving.</p>
          )}
        </div>

        {/* Progressive stop ladder — the field is the source of truth; the table is its consequence. */}
        <div className="flex flex-col gap-4 border-t border-line pt-6">
          <StopLadderField value={tightenPct} onChange={setTightenPct} error={tighten.error} />
          <LadderPreview config={effectiveConfig} riskClass={riskClass} />
        </div>

        {/* Change message */}
        <label className="flex flex-col gap-2">
          <span className={labelCls}>What changed? — optional, saved to the bot&apos;s history</span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={dirty ? describeChanges() : "e.g. Re-optimised TP ladder on fresh April–June signals; leverage 7→5 on balanced."}
            className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none"
          />
          <span className="text-xs text-muted">Leave it empty and the summary above is recorded instead.</span>
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
