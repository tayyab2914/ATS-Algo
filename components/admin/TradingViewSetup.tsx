import { AdminCard } from "@/components/admin/AdminCard";
import { CopyField } from "@/components/admin/CopyField";
import { Notice } from "@/components/ui/Notice";

/**
 * Where this bot's alerts go, and how the indicator must be set up to match.
 *
 * That matters: the indicator decides WHEN a rung is touched, but the ladder we
 * actually place comes from the config JSON. If the indicator's tp1..tp6 and
 * stop-loss don't match the bot's profile, the alerts describe a different trade
 * than the one being executed.
 *
 * The alert BODIES are not here — they live in the JSON signal settings panel,
 * which is where the words they use are chosen. Printing them in two places is how
 * a bot ends up wired to a body its receiver was never taught.
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

export function TradingViewSetup({ webhookUrl, secret, profile, riskLabel }: TradingViewSetupProps) {
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

      <CopyField label="Webhook URL" value={webhookUrl} />
      {secret && <CopyField label="Signal secret (shared by every bot — set once in the indicator's settings)" value={secret} />}

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

      <p className="text-[11px] leading-4 text-muted">
        Set the alert&apos;s condition to <span className="text-white">Any alert() function call</span> so the indicator&apos;s own
        message is what reaches the webhook, then paste the bodies from{" "}
        <span className="text-white">JSON signal settings</span> below into the indicator&apos;s Long and Short fields.
      </p>
    </AdminCard>
  );
}
