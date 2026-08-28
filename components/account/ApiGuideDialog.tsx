"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ExchangeGuide } from "@/lib/exchange-guides";

/**
 * The "Full guide" modal: a venue's API-key walkthrough, steps and screenshots,
 * next to the form the member is filling in.
 *
 * Portalled into `document.body` for the same reason {@link ConfirmDialog} is —
 * the Account page mounts this inside cards that create their own stacking
 * contexts, which would otherwise trap a `fixed` overlay behind the page.
 *
 * Screenshots are `loading="lazy"`: the whole set is a megabyte across four
 * venues, and nobody who never opens a guide should pay for it.
 */
export function ApiGuideDialog({
  open,
  guide,
  onClose,
}: {
  open: boolean;
  guide: ExchangeGuide | null;
  onClose: () => void;
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

  if (!open || !guide || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={guide.title}
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      {/*
        The card owns the scrolling, and the header sits OUTSIDE the scroll box.
        It used to be one tall card scrolling inside the overlay with a
        `position: sticky` header, and that clipped: a sticky header sticks to its
        SCROLL CONTAINER, so the screenshots below it slid up through the overlay's
        padding and drew in the strip above the title before the header could cover
        them. A fixed-height flex column with its own overflow region has no such
        strip — the header is a sibling of the scroll area, not an element floating
        over it — and it keeps the close button reachable at any scroll depth.
      */}
      <div className="relative z-10 flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold text-white">{guide.title}</h2>
            <p className="text-xs text-muted">
              How to set up the API connection between the exchange and ATS-ALGO, step by step.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guide"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
          {guide.note && (
            <p className="mb-4 rounded-xl border border-[#F4A825]/30 bg-[#F4A825]/10 px-3 py-2 text-xs leading-[18px] text-[#F4A825]">
              {guide.note}
            </p>
          )}

          <ol className="flex flex-col gap-5">
            {guide.steps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-sm leading-[21px] text-white/90">{step.text}</p>
                  {step.image && (
                    // eslint-disable-next-line @next/next/no-img-element -- a static screenshot from /public; the optimizer buys nothing here and the modal is lazy anyway
                    <img
                      src={step.image}
                      alt=""
                      loading="lazy"
                      className="max-w-full rounded-lg border border-line bg-white"
                    />
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>,
    document.body,
  );
}
