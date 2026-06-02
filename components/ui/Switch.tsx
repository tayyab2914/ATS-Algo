"use client";

import { cn } from "@/lib/cn";

/**
 * Accessible on/off toggle switch — a `role="switch"` button with a sliding
 * knob and an in-track ON/OFF label. The parent owns the `checked` state;
 * `onChange` fires with the next value on click. Matches the design's cyan
 * accent + glow aesthetic and is sized to stand out.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  id,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-9 w-[76px] shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200 outline-none",
        "focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "disabled:cursor-not-allowed disabled:opacity-60",
        checked
          ? "border-accent bg-accent shadow-[0_0_22px_rgba(40,184,213,0.6)]"
          : "border-line bg-white/5 hover:border-muted/60",
      )}
    >
      {/* In-track label sits opposite the knob. */}
      <span
        className={cn(
          "absolute text-[11px] font-bold uppercase tracking-wider transition-all duration-200",
          checked ? "left-3 text-[#0a0a0a]" : "right-3 text-muted",
        )}
      >
        {checked ? "On" : "Off"}
      </span>

      <span
        className={cn(
          "pointer-events-none inline-block size-7 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-out",
          checked ? "translate-x-[42px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
