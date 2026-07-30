"use client";

import { cn } from "@/lib/cn";
import { RISK_TO_PROFILE, type RiskClass } from "@/lib/bot-config";
import { leverageError, MAX_LEVERAGE, MIN_LEVERAGE } from "@/lib/validation";

/**
 * The multiplier the bot trades — `config.profiles[<risk>].lev`, editable on the
 * fly without re-uploading the JSON.
 *
 * Scoped to the ONE profile the bot's risk class selects, which is the only one the
 * executor ever reads. The other two profiles are left exactly as the simulator
 * emitted them, because they are different risk appetites and are *meant* to carry
 * different multipliers (the reference config ships 4× / 7× / 10×). The stop ladder
 * next to this field is the opposite case and writes all three — it is a percentage
 * of each profile's own stop, so one number stays coherent across them.
 *
 * Leverage feeds order SIZING, so changing it changes both what the engine places
 * and what the published backtest returns: the save route re-runs the backtest.
 */
export function LeverageField({
  value,
  onChange,
  stored,
  riskClass,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  /** What's currently on the row for this risk class, for the "was" hint. */
  stored: number | null;
  riskClass: RiskClass;
  error: string | null;
}) {
  const parsed = parseLeverageInput(value);
  const changed = parsed.value !== null && parsed.value !== stored;
  return (
    <label className="flex flex-col gap-2">
      <span className="text-xs leading-[18px] text-muted">Leverage — {RISK_TO_PROFILE[riskClass]} profile</span>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder={`${MIN_LEVERAGE}–${MAX_LEVERAGE}`}
          aria-invalid={error ? true : undefined}
          className={cn(
            "h-[42px] w-full rounded-lg border bg-background px-3 pr-8 text-sm text-white placeholder:text-muted focus:outline-none",
            error
              ? "border-[#D2031E] focus:border-[#D2031E]"
              : changed
                ? "border-accent focus:border-accent"
                : "border-line focus:border-accent/60",
          )}
        />
        {value.trim() ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">x</span>
        ) : null}
      </div>
      {error ? (
        <span className="text-xs text-[#D2031E]">{error}</span>
      ) : changed ? (
        <span className="text-xs text-accent">
          {stored ?? "—"}x → {parsed.value}x · re-runs the backtest on save
        </span>
      ) : (
        <span className="text-xs text-muted">Applies to new positions only — open trades keep the leverage they opened with.</span>
      )}
    </label>
  );
}

/**
 * Parse the raw box. Empty ⇒ leave the stored leverage alone (the field is never a
 * way to REMOVE a multiplier — a position has to have one). Range is checked here
 * against the same bounds the API enforces, so the admin reads one message.
 */
export function parseLeverageInput(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: null };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { value: null, error: "Leverage must be a number." };
  const invalid = leverageError(parsed);
  return invalid ? { value: null, error: invalid } : { value: parsed, error: null };
}
