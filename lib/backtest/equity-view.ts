/**
 * Shared equity-curve view model for the bot detail pages (admin + member-facing
 * Bot Library). Buckets a bot's real backtested trades into the last ≤12 calendar
 * months and normalises them for {@link EquityChart}, so both detail pages draw
 * the exact same curve from the exact same logic.
 */
import { profileEquityCurves, type BotConfig, type RiskKey } from "./engine";

export type BotEquityView = {
  /** Selected-profile curve, normalised 0..1 (1 = top of chart). */
  curve: number[];
  /** Safe-profile curve, normalised the same way (for the comparison line). */
  safe: number[];
  /** Month labels aligned to the curve points. */
  months: string[];
  /** Largest peak-to-trough decline (%) over the selected curve. */
  maxDrawdown: number;
};

/**
 * Build the two normalised equity series (the bot's own profile + the safe
 * profile) bucketed into the last ≤12 calendar months. Returns null when there
 * isn't enough trade history to draw anything.
 */
export function buildBotEquity(config: BotConfig, csv: string, riskKey: RiskKey): BotEquityView | null {
  // Trade construction is profile-independent, so build both curves from a
  // single parse rather than re-parsing the CSV per profile.
  const keys: RiskKey[] = riskKey === "safe" ? ["safe"] : [riskKey, "safe"];
  const curves = profileEquityCurves(config, csv, keys);
  const selected = curves[riskKey];
  const safe = curves.safe;

  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const p of selected) {
    if (p.time < minTime) minTime = p.time;
    if (p.time > maxTime) maxTime = p.time;
  }
  for (const p of safe) {
    if (p.time < minTime) minTime = p.time;
    if (p.time > maxTime) maxTime = p.time;
  }
  if (!Number.isFinite(minTime)) return null;

  const end = new Date(maxTime);
  const span = (end.getFullYear() - new Date(minTime).getFullYear()) * 12 + (end.getMonth() - new Date(minTime).getMonth()) + 1;
  const n = Math.min(12, Math.max(1, span));

  const buckets: { label: string; end: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const cutoff = new Date(end.getFullYear(), end.getMonth() - i + 1, 1).getTime(); // start of next month
    const label = new Date(end.getFullYear(), end.getMonth() - i, 1).toLocaleString("en-US", { month: "short" });
    buckets.push({ label, end: cutoff });
  }

  const bucketEquity = (points: { time: number; equity: number }[]) => {
    const out: number[] = [];
    let lastEq = 1;
    let idx = 0;
    for (const b of buckets) {
      while (idx < points.length && points[idx].time < b.end) {
        lastEq = points[idx].equity;
        idx += 1;
      }
      out.push(lastEq);
    }
    return out;
  };

  const curveRaw = bucketEquity(selected);
  const safeRaw = bucketEquity(safe);
  const all = [...curveRaw, ...safeRaw];
  const min = Math.min(...all);
  const max = Math.max(...all);
  // Map higher equity → smaller y (top of chart); leave a margin top/bottom.
  const norm = (v: number) => (max === min ? 0.5 : 0.9 - 0.8 * ((v - min) / (max - min)));

  return {
    curve: curveRaw.map(norm),
    safe: safeRaw.map(norm),
    months: buckets.map((b) => b.label),
    maxDrawdown: maxDrawdownPct(curveRaw),
  };
}

/**
 * Largest peak-to-trough decline (%) over a real equity series (1 = start
 * capital). Tracks the running peak and the deepest fall from it.
 */
function maxDrawdownPct(equity: number[]): number {
  let peak = -Infinity;
  let maxDD = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    if (peak > 0) maxDD = Math.max(maxDD, (peak - e) / peak);
  }
  return maxDD * 100;
}
