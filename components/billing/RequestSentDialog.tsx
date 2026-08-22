"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";

/**
 * Confirmation shown the moment an access request lands. There is no payment
 * step to redirect to, so this dialog IS the completion of the flow — without it
 * the button would just go quiet and the member would click it again.
 *
 * Mirrors {@link AuthRequiredDialog}'s mechanics: portalled to `document.body` so
 * it escapes the sidebar's stacking context, Escape/backdrop dismiss, and body
 * scroll locked while open.
 */
export function RequestSentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      aria-labelledby="request-sent-title"
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)]">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-success/10 text-success">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="m5 12.5 4.5 4.5L19 7.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <h2 id="request-sent-title" className="mt-4 text-lg font-semibold text-white">
          Subscription request sent
        </h2>
        <p className="mt-2 text-sm leading-[21px] text-muted">
          Your subscription request has been sent to the admin. You&apos;ll get full access as soon
          as it&apos;s approved — no need to send it again.
        </p>
        <div className="mt-6">
          <Button variant="primary" onClick={onClose}>
            Got it
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
