"use client";

import { useState } from "react";
import { AdminCard } from "@/components/admin/AdminCard";
import { Notice } from "@/components/ui/Notice";
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
 * Every payload here is a constant string. Nothing in a webhook body is
 * substituted — not the indicator's own `{TIME}`/`{SIDE}`/`{PRICE}`, and not even
 * TradingView's documented `{{close}}`; all of them arrive literally and get the
 * alert rejected. The entry price comes from the venue at execution time instead.
 *
 * The secret is one shared value for all bots (`SIGNAL_SECRET`), since it is
 * entered once in the indicator's settings. It is shown in full because this page
 * is admin-only and the operator has to be able to paste it.
 */

export type TradingViewSetupProps = {
  webhookUrl: string;
  /** `SIGNAL_SECRET` as configured on the server, or null if it is unset. */
  secret: string | null;
  /** The profile this bot actually trades, selected by its risk class. */
  profile: { tp: number[]; sl: number; be: number | null; lev: number; sl_tighten_pct?: number | null } | null;
  riskLabel: string;
};

const PLACEHOLDER = "<set-SIGNAL_SECRET-on-the-server>";

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

export function TradingViewSetup({ webhookUrl, secret, profile, riskLabel }: TradingViewSetupProps) {
  const token = secret ?? PLACEHOLDER;
  const json = (action: string) => JSON.stringify({ action, secret: token });

  return (
    <AdminCard
      title="TradingView alert"
      subtitle="Paste these into the ATS indicator. The values come from this bot's own config, so the alert can't drift from what gets traded."
    >
      {!secret && (
        <Notice
          notice={{
            type: "error",
            message: "SIGNAL_SECRET is not set on this server, so every webhook is rejected with 401. Set it in the environment and restart — it is one shared value for all bots.",
          }}
        />
      )}

      <Field label="Webhook URL" value={webhookUrl} />
      {secret && <Field label="Signal secret (shared by every bot — set once in the indicator's settings)" value={secret} />}

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
              {profile.sl_tighten_pct ? (
                <>
                  Progressive stop ladder (tighten {profile.sl_tighten_pct}% per take-profit)
                </>
              ) : (
                <>Break-even after rung {profile.be ?? "—"}</>
              )}{" "}
              and {profile.lev}x leverage are applied by the platform, not the indicator.
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Field label="Long Entry JSON" value={json("enter_long")} />
        <Field label="Short Entry JSON" value={json("enter_short")} />
        <Field label="Stoploss / ATR exit JSON" value={json("exit")} />
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <Field key={n} label={`TP ${n} JSON`} value={json(`tp${n}`)} />
        ))}
      </div>

      <p className={cn("text-[11px] leading-4", secret ? "text-muted" : "text-[#D2031E]")}>
        Paste each of these verbatim — there is nothing to fill in and no placeholder to substitute. Long and short are separate alerts,
        so the direction rides in the action; the entry price is read from the exchange when the order is placed. A redelivered alert is
        dropped for five minutes, so a retry cannot reverse an open position.
      </p>
    </AdminCard>
  );
}
