"use client";

import { useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { Notice, type NoticeData } from "@/components/ui/Notice";
import { cn } from "@/lib/cn";

/**
 * Everything needed to wire this bot's TradingView alert, generated from the bot's
 * own config so the two cannot drift.
 *
 * That matters: the indicator decides WHEN a rung is touched, but the ladder we
 * actually place comes from the config JSON. If the indicator's tp1..tp6 and
 * stop-loss don't match the bot's profile, the alerts describe a different trade
 * than the one being executed.
 *
 * The secret is shown once, at the moment it is minted. It is stored encrypted and
 * cannot be read back — regenerating is the only way to see a value again.
 */

export type TradingViewSetupProps = {
  botId: string;
  webhookUrl: string;
  hasSecret: boolean;
  /** The profile this bot actually trades, selected by its risk class. */
  profile: { tp: number[]; sl: number; be: number | null; lev: number } | null;
  riskLabel: string;
};

const PLACEHOLDER = "<paste-your-secret>";

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-white/5"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-lg border border-line bg-background px-3 py-2 text-[11px] leading-5 text-white">
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export function TradingViewSetup({ botId, webhookUrl, hasSecret, profile, riskLabel }: TradingViewSetupProps) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeData | null>(null);

  const token = secret ?? PLACEHOLDER;
  const payload = (body: Record<string, string>) => JSON.stringify({ ...body, bot_id: botId, ts: "{TIME}", secret: token });
  const entryJson = payload({ action: "enter", side: "{SIDE}", price: "{PRICE}" });
  const exitJson = payload({ action: "exit" });
  const tpJson = (n: number) => payload({ action: `tp${n}` });

  async function rotate() {
    if (hasSecret && !confirm("Regenerating invalidates the current secret immediately. This bot's TradingView alert will stop working until you paste the new payload. Continue?")) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/bots/${botId}/signal-secret`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: "error", message: data.error ?? "Could not generate a secret" });
        return;
      }
      setSecret(data.secret);
      setNotice({ type: "success", message: "Secret generated. Copy it now — it can never be shown again." });
    } catch {
      setNotice({ type: "error", message: "Couldn't reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminCard
      title="TradingView alert"
      subtitle="Paste these into the ATS indicator. The values come from this bot's own config, so the alert can't drift from what gets traded."
    >
      {!hasSecret && !secret && (
        <Notice notice={{ type: "info", message: "This bot has no signal secret yet, so its webhook rejects everything. Generate one to enable it." }} />
      )}
      {notice && <Notice notice={notice} />}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={rotate}
          disabled={busy}
          className="inline-flex h-10 items-center rounded-xl border border-accent px-4 text-sm font-semibold text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
        >
          {busy ? "Generating…" : hasSecret || secret ? "Regenerate secret" : "Generate secret"}
        </button>
        {secret && <CopyButton value={secret} label="Copy secret" />}
      </div>

      {secret && (
        <div className="rounded-xl border border-accent/30 bg-accent/10 p-3">
          <p className="mb-1 text-[11px] font-semibold text-accent">Shown once — copy it now</p>
          <code className="block overflow-x-auto whitespace-pre text-[11px] text-white">{secret}</code>
        </div>
      )}

      <Field label="Webhook URL" value={webhookUrl} />

      {profile && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted">Indicator settings ({riskLabel} profile)</span>
          <div className="rounded-lg border border-line bg-background px-3 py-2 text-[11px] leading-5 text-white">
            {profile.tp.map((tp, i) => (
              <div key={i}>
                TP {i + 1} % = <span className="text-accent">{tp}</span>
              </div>
            ))}
            <div className="mt-1">
              Fixed Stop Loss % = <span className="text-accent">{profile.sl}</span>
            </div>
            <div className="text-[#D2031E]">Enable ATR Trailing Stop = OFF</div>
            <div className="mt-1 text-muted">
              Break-even after rung {profile.be ?? "—"} and {profile.lev}x leverage are applied by the platform, not the
              indicator.
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Field label="Entry Signal JSON" value={entryJson} />
        <Field label="Stoploss / ATR exit JSON" value={exitJson} />
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <Field key={n} label={`TP ${n} JSON`} value={tpJson(n)} />
        ))}
      </div>

      <p className={cn("text-[11px] leading-4", secret ? "text-muted" : "text-[#D2031E]")}>
        {secret
          ? "The indicator must be patched so {SIDE}, {TIME} and {PRICE} are substituted — see TRADINGVIEW.md. Without {TIME}, a retried alert opens a second position."
          : "Generate a secret first; the payloads above show a placeholder until then."}
      </p>
    </AdminCard>
  );
}
