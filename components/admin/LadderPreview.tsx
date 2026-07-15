import {
  DEFAULT_SLIPPAGE_PCT,
  ladderPreview,
  profileFor,
  ratchetPct,
  type BotConfig,
  type RiskClass,
} from "@/lib/bot-config";
import { cn } from "@/lib/cn";

/**
 * The upload-time tuning surface for the progressive stop ladder.
 *
 * Reads the loaded config (never a live position) and shows, for the selected risk
 * profile, where the stop sits after each take-profit and what PnL you'd take if it fired
 * there — so `sl_tighten_pct` is a decision, not a guess. Rows that breach the soundness
 * rule (G2) are flagged red; validation rejects such a config on save, so this is where an
 * admin sees it BEFORE that happens. A config without `sl_tighten_pct` runs the legacy
 * break-even move instead, and the table says so rather than rendering empty.
 */
export function LadderPreview({ config, riskClass }: { config: BotConfig; riskClass: RiskClass }) {
  const profile = profileFor(config, riskClass);
  if (!profile) return null;

  const takerFeePct = Number(config.fees?.taker_fee_pct ?? 0);
  const slippagePct = Number(config.slippage_pct ?? DEFAULT_SLIPPAGE_PCT);
  const tighten = ratchetPct(profile);
  const rows = ladderPreview(profile, takerFeePct, slippagePct);

  // Legacy config — no ladder. The stop uses the one-shot break-even at TP{be}.
  if (tighten === null || rows.length === 0) {
    return (
      <div className="rounded-2xl border border-line p-4">
        <p className="text-xs font-semibold text-muted">Progressive stop ladder</p>
        <p className="mt-1 text-sm text-muted">
          This config has no <span className="text-white">sl_tighten_pct</span> — the stop uses the legacy
          break-even move
          {profile.be ? (
            <>
              {" "}
              (to entry after <span className="text-white">TP{profile.be}</span>)
            </>
          ) : null}
          . Add <span className="text-white">sl_tighten_pct</span> to the <span className="text-white">{RISK_KEY[riskClass]}</span>{" "}
          profile to enable the per-take-profit ladder.
        </p>
      </div>
    );
  }

  const anyViolation = rows.some((r) => r.violatesG2);
  const buffer = 2 * takerFeePct + slippagePct;
  const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(2)}%`;
  const location = (d: number) => {
    if (Math.abs(d) < 1e-9) return "at entry";
    return d > 0 ? `${d.toFixed(2)}% below entry` : `${Math.abs(d).toFixed(2)}% above entry`;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted">
          Progressive stop ladder · tightens <span className="text-white">{tighten}%</span> per take-profit ·
          buffer <span className="text-white">{buffer.toFixed(3)}%</span>
        </p>
        {anyViolation ? (
          <span className="rounded-full bg-[#D2031E]/15 px-2.5 py-1 text-xs font-semibold text-[#D2031E]">
            Unsound — validation rejects this on save
          </span>
        ) : (
          <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-semibold text-success">
            Sound
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs font-semibold text-muted">
              <th className="px-4 py-3">Rungs filled</th>
              <th className="px-4 py-3 text-center">Stop distance d(n)</th>
              <th className="px-4 py-3 text-center">Where the stop sits (LONG)</th>
              <th className="px-4 py-3 text-center">TP reached</th>
              <th className="px-4 py-3 text-center">PnL if stopped</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.n} className={cn("border-b border-line last:border-0", r.violatesG2 && "bg-[#D2031E]/10")}>
                <td className="px-4 py-3 font-semibold text-white">{r.n}</td>
                <td
                  className={cn(
                    "px-4 py-3 text-center font-semibold",
                    r.violatesG2 ? "text-[#D2031E]" : r.profitLocked ? "text-success" : "text-white",
                  )}
                >
                  {signed(r.distancePct)}
                </td>
                <td className={cn("px-4 py-3 text-center", r.profitLocked ? "text-success" : "text-muted")}>
                  {location(r.distancePct)}
                  {r.profitLocked ? " · profit locked" : null}
                </td>
                <td className="px-4 py-3 text-center text-muted">
                  {r.tpNearestPct === null ? "—" : `${r.tpNearestPct.toFixed(2)}%`}
                </td>
                <td className={cn("px-4 py-3 text-center font-semibold", r.pnlPct >= 0 ? "text-success" : "text-white")}>
                  {signed(r.pnlPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        <span className="font-semibold">n</span> counts take-profits filled; whichever stop fires first closes the whole
        trade. PnL is % of position notional, before fees. A <span className="text-[#D2031E]">red</span> row breaches the
        soundness rule (G2) — the stop would sit beyond the market and never protect — and validation rejects the config.{" "}
        <span className="text-success">Green</span> rows lock profit above entry.
      </p>
    </div>
  );
}

const RISK_KEY: Record<RiskClass, string> = { LOW: "safe", MEDIUM: "balanced", HIGH: "aggressive" };
