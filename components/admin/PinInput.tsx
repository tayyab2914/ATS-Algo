"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

/**
 * Segmented numeric PIN entry — N single-digit boxes with auto-advance on type,
 * backspace step-back, arrow-key navigation and full-code paste. Reports the
 * joined value through `onChange`; the parent owns submission.
 */
export function PinInput({
  length = 4,
  onChange,
}: {
  length?: number;
  onChange?: (value: string) => void;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array<string>(length).fill(""));
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const focusAt = (index: number) => {
    const el = inputs.current[index];
    el?.focus();
    el?.select();
  };

  const commit = (next: string[]) => {
    setDigits(next);
    onChange?.(next.join(""));
  };

  const handleInput = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = digit;
    commit(next);
    if (digit && index < length - 1) focusAt(index + 1);
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      const next = [...digits];
      next[index - 1] = "";
      commit(next);
      focusAt(index - 1);
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusAt(index - 1);
    } else if (event.key === "ArrowRight" && index < length - 1) {
      event.preventDefault();
      focusAt(index + 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (!pasted) return;
    event.preventDefault();
    const next = Array<string>(length).fill("");
    pasted.split("").forEach((digit, i) => (next[i] = digit));
    commit(next);
    focusAt(Math.min(pasted.length, length - 1));
  };

  return (
    <div className="flex w-full gap-2" role="group" aria-label={`${length}-digit PIN`}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={1}
          placeholder="0"
          aria-label={`Digit ${index + 1}`}
          value={digit}
          onChange={(event) => handleInput(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          className="h-[63px] w-full rounded-lg border border-line bg-background text-center text-sm leading-[21px] text-white placeholder-muted outline-none transition focus:border-accent"
        />
      ))}
    </div>
  );
}
