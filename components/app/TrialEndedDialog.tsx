"use client";

import Link from "next/link";
import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Shown when an expired-trial guest taps a locked tab. Rather than letting the
 * click navigate — which bounced through the destination's dark loading skeleton
 * before the server redirect landed them back on Billing (a jarring black flash)
 * — the {@link Sidebar} intercepts the click and pops this instead. The only way
 * forward is to subscribe, so the single CTA routes to Billing.
 *
 * Mirrors {@link AuthRequiredDialog}'s mechanics: portalled to `document.body` so
 * it escapes the sidebar's stacking context, Escape/backdrop dismiss, and body
 * scroll locked while open. Copy matches the expired {@link GuestTrialBanner}.
 */
export function TrialEndedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // `open` only flips true from a client interaction, so `document` is present;
  // the guard keeps any server render a safe no-op.
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-ended-title"
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)]">
        <h2 id="trial-ended-title" className="text-lg font-semibold text-white">
          Your free trial has ended
        </h2>
        <p className="mt-2 text-sm leading-[21px] text-muted">
          Subscribe to unlock the dashboard, deploy bots, and track live performance. Until then,
          only Billing is available.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href="/billing?gated=1"
            onClick={onClose}
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-accent px-4 text-base font-semibold leading-6 text-[#121212] transition-opacity hover:opacity-90"
          >
            Become a member
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="w-full text-center text-xs text-muted underline-offset-4 transition-colors hover:text-white hover:underline"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
