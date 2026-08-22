"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";

/**
 * Shown when a signed-out visitor tries to request access. A request has to
 * attach to an account, so rather than silently bouncing them to the login page
 * we explain why and offer both paths — log in or create a free account.
 * Dismissing leaves them where they were.
 *
 * Mirrors {@link ConfirmDialog}'s mechanics: portalled to `document.body` so it
 * escapes the sidebar's stacking context, Escape/backdrop dismiss, and body
 * scroll locked while open.
 */
export function AuthRequiredDialog({
  open,
  onClose,
  loginHref,
  signupHref,
}: {
  open: boolean;
  onClose: () => void;
  /** Where "Log in" goes (carries a `next` back to billing). */
  loginHref: string;
  /** Where "Create account" goes. */
  signupHref: string;
}) {
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
      aria-labelledby="auth-required-title"
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)]">
        <h2 id="auth-required-title" className="text-lg font-semibold text-white">
          Log in to request access
        </h2>
        <p className="mt-2 text-sm leading-[21px] text-muted">
          Requesting access needs an account. Log in to come straight back and send your request, or
          create a free account to get started.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Button variant="primary" onClick={() => window.location.assign(loginHref)}>
            Log in
          </Button>
          <Button variant="outline" onClick={() => window.location.assign(signupHref)}>
            Create a free account
          </Button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full text-center text-xs text-muted underline-offset-4 transition-colors hover:text-white hover:underline"
        >
          Not now
        </button>
      </div>
    </div>,
    document.body,
  );
}
