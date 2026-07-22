"use client";

import { cn } from "@/lib/cn";

/**
 * The one number that drives the progressive stop ladder, for the whole bot.
 *
 * The ladder used to arrive only inside the uploaded JSON, which meant tuning it
 * required hand-editing a file. It is a risk decision, so it belongs to the admin
 * creating the bot: this field is the source of truth, and it is written to every
 * profile on save (see `withRatchetPct`).
 *
 * Pair it with `<LadderPreview>` — this is the knob, that is the consequence.
 *
 * Left EMPTY the bot has no ladder and falls back to the legacy one-shot `be` move,
 * which is exactly how every bot uploaded before this field existed behaves. That
 * fallback is deliberate, not an oversight: clearing the box is how you ask for it.
 */
export function StopLadderField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex max-w-md flex-col gap-2">
        <span className="text-xs leading-[18px] text-muted">
          Stop tightening per take-profit (%) — optional
        </span>
        <div className="relative">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 25 — leave empty for no ladder"
            aria-invalid={error ? true : undefined}
            className={cn(
              "h-[42px] w-full rounded-lg border bg-background px-3 pr-8 text-sm text-white placeholder:text-muted focus:outline-none",
              error ? "border-[#D2031E] focus:border-[#D2031E]" : "border-line focus:border-accent/60",
            )}
          />
          {value.trim() ? (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">%</span>
          ) : null}
        </div>
      </label>

      <p className="max-w-2xl text-xs text-muted">
        Each take-profit that fills pulls the stop this much closer to entry, as a share of the bot&apos;s original
        stop-loss — so <span className="text-white">25</span> reaches entry after four take-profits and locks profit
        after five. Applies to all three risk profiles, and to every take-profit rung. Open trades keep the rules they
        opened with.
      </p>

      {error ? <p className="max-w-2xl text-xs text-[#D2031E]">{error}</p> : null}
    </div>
  );
}

/**
 * Parse the raw box. Empty ⇒ no ladder; anything unparseable is caught here, and
 * everything else (range, geometry) is left to `botConfigError` so the admin reads
 * the same message the API would reject them with.
 */
export function parseTightenInput(raw: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, error: null };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { value: null, error: "Stop tightening must be a number, or empty for no ladder." };
  return { value: parsed, error: null };
}
