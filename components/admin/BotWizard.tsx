"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { BacktestResults } from "@/components/admin/BacktestResults";
import { CheckIcon } from "@/components/admin/admin-icons";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { runBacktest, type BacktestResult, type BotConfig, type RiskClass } from "@/lib/backtest/engine";
import { cn } from "@/lib/cn";

const RISKS: { value: RiskClass; label: string }[] = [
  { value: "LOW", label: "Low (safe)" },
  { value: "MEDIUM", label: "Medium (balanced)" },
  { value: "HIGH", label: "High (aggressive)" },
];
const STEPS = ["Category", "Config (JSON)", "Signals (CSV)", "Backtest & Save"];

const inputCls =
  "h-[42px] w-full rounded-lg border border-line bg-background px-3 text-sm text-white placeholder:text-muted focus:border-accent/60 focus:outline-none";
const labelCls = "text-xs leading-[18px] text-muted";

export function BotWizard({ categories }: { categories: string[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [notice, setNotice] = useState<NoticeData | null>(null);
  const [pending, setPending] = useState(false);

  // Collected inputs.
  const [category, setCategory] = useState("");
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [name, setName] = useState("");
  const [timeframe, setTimeframe] = useState("");
  const [riskClass, setRiskClass] = useState<RiskClass>("MEDIUM");
  const [csvText, setCsvText] = useState("");
  const [csvFilename, setCsvFilename] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);

  const jsonRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  async function onJsonPicked(file: File) {
    setNotice(null);
    try {
      const parsed = JSON.parse(await file.text()) as BotConfig;
      if (!parsed?.profiles?.balanced) {
        setNotice({ type: "error", message: "That JSON has no trading profiles (safe / balanced / aggressive)." });
        return;
      }
      setConfig(parsed);
      setName((n) => n || (parsed.name ? `${parsed.name} Bot` : ""));
      setTimeframe((t) => t || (parsed.timeframe ? `${parsed.timeframe}m` : ""));
      if (parsed.type && categories.some((c) => c.toLowerCase() === parsed.type!.toLowerCase())) {
        setCategory((c) => c || categories.find((x) => x.toLowerCase() === parsed.type!.toLowerCase())!);
      }
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
  }

  function runPreview() {
    if (!config) return;
    setNotice(null);
    try {
      setResult(runBacktest(config, csvText));
      setStep(3);
    } catch {
      setNotice({ type: "error", message: "Backtest failed — check the CSV signal format." });
    }
  }

  async function save() {
    if (!config) return;
    setPending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, timeframe, riskClass, config, csvText, csvFilename }),
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

  const canNext = [
    Boolean(category),
    Boolean(config && name.trim() && timeframe.trim()),
    Boolean(csvText),
  ];

  return (
    <AdminCard title="Add New Bot" subtitle="Pick a category, upload the bot config and signal CSV, backtest, then save.">
      <div className="flex flex-col gap-6">
        <Stepper step={step} />
        {notice && <Notice notice={notice} />}

        {step === 0 && (
          <div className="flex max-w-md flex-col gap-2">
            <span className={labelCls}>Category</span>
            <div className="relative">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={cn(inputCls, "appearance-none pr-10")}>
                <option value="" disabled>Select a category</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-6">
            <UploadTile
              label="Bot config (JSON)"
              hint={config ? `Loaded${config.name ? `: ${config.name}` : ""} — ${Object.keys(config.profiles ?? {}).length} profiles` : "Upload the bot's .json config"}
              done={Boolean(config)}
              accept="application/json,.json"
              inputRef={jsonRef}
              onPick={onJsonPicked}
            />
            {config && (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                <label className="flex flex-col gap-2">
                  <span className={labelCls}>Bot Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alpha BTC Bot" className={inputCls} />
                </label>
                <label className="flex flex-col gap-2">
                  <span className={labelCls}>Timeframe</span>
                  <input value={timeframe} onChange={(e) => setTimeframe(e.target.value)} placeholder="e.g. 5m" className={inputCls} />
                </label>
                <label className="flex flex-col gap-2">
                  <span className={labelCls}>Risk Class</span>
                  <select value={riskClass} onChange={(e) => setRiskClass(e.target.value as RiskClass)} className={cn(inputCls, "appearance-none pr-10")}>
                    {RISKS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </label>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <UploadTile
            label="Signal data (CSV)"
            hint={csvFilename ? `Loaded: ${csvFilename}` : "Upload the OHLCV + signals .csv"}
            done={Boolean(csvText)}
            accept="text/csv,.csv"
            inputRef={csvRef}
            onPick={onCsvPicked}
          />
        )}

        {step === 3 && result && (
          <BacktestResults name={name} timeframe={timeframe} riskClass={riskClass} result={result} />
        )}

        {/* Nav */}
        <div className="flex items-center justify-between border-t border-line pt-4">
          <button
            type="button"
            disabled={step === 0 || pending}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="rounded-xl border border-line px-4 py-2 text-sm text-muted transition-colors hover:text-white disabled:opacity-40"
          >
            Back
          </button>

          {step < 2 && (
            <button
              type="button"
              disabled={!canNext[step]}
              onClick={() => setStep((s) => s + 1)}
              className="rounded-2xl bg-accent px-5 py-2 text-sm font-semibold text-[#121212] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              Next
            </button>
          )}
          {step === 2 && (
            <button
              type="button"
              disabled={!canNext[2]}
              onClick={runPreview}
              className="rounded-2xl bg-accent px-5 py-2 text-sm font-semibold text-[#121212] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
            >
              Run Backtest
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              disabled={pending}
              onClick={save}
              className="rounded-2xl bg-accent px-5 py-2 text-sm font-semibold text-[#121212] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save Bot"}
            </button>
          )}
        </div>
      </div>
    </AdminCard>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
              i < step ? "bg-accent text-[#121212]" : i === step ? "border border-accent text-accent" : "border border-line text-muted",
            )}
          >
            {i < step ? <CheckIcon className="size-3.5" /> : i + 1}
          </span>
          <span className={cn("text-xs", i === step ? "text-white" : "text-muted")}>{label}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-line" />}
        </div>
      ))}
    </div>
  );
}

function UploadTile({
  label,
  hint,
  done,
  accept,
  inputRef,
  onPick,
}: {
  label: string;
  hint: string;
  done: boolean;
  accept: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (file: File) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className={labelCls}>{label}</span>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex items-center justify-between gap-4 rounded-2xl border border-dashed px-5 py-8 text-left transition-colors",
          done ? "border-accent/50 bg-accent/5" : "border-line bg-background hover:border-accent/40",
        )}
      >
        <span className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-white">{done ? "File loaded" : "Click to choose a file"}</span>
          <span className="text-xs text-muted">{hint}</span>
        </span>
        {done && (
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
