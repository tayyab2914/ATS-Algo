"use client";

import { useState } from "react";

/**
 * A read-only value with a copy button — webhook URLs, secrets, alert bodies.
 *
 * Everything on the bot's setup surface is meant to be pasted somewhere else, and
 * silently mistyping a secret or an alert body is the most expensive kind of typo
 * here: it produces a bot that simply never trades, with the reason buried in the
 * execution log. So none of these values is ever presented without a copy button.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
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

export function CopyField({ label, value }: { label: string; value: string }) {
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
