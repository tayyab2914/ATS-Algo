"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Centered confirmation modal for actions worth a second look (e.g. signing
 * out). Renders nothing when closed. Clicking the backdrop or pressing Escape
 * cancels, unless an action is in flight (`pending`). Body scroll is locked
 * while open so the page behind can't move under the dialog.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, buttons disable and dismissal is blocked while the action runs. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onCancel();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={() => !pending && onCancel()}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)]">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {description && <p className="mt-2 text-sm leading-[21px] text-muted">{description}</p>}
        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant="primary" className="flex-1" onClick={onConfirm} disabled={pending}>
            {pending ? "Please wait…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
