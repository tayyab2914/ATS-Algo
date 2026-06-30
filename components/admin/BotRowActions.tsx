"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DotsIcon, EyeIcon, PencilIcon, TrashIcon } from "@/components/admin/admin-icons";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn } from "@/lib/cn";

const MENU_WIDTH = 168;

/** Per-row kebab menu (View / Edit / Delete-with-confirm) for the bots table. */
export function BotRowActions({ botId, botName }: { botId: string; botName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Position the menu under the trigger, right-aligned so it stays inside the table.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.right - MENU_WIDTH });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function onDelete() {
    setPending(true);
    try {
      const res = await fetch(`/api/admin/bots/${botId}`, { method: "DELETE" });
      if (!res.ok) {
        setPending(false);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setPending(false);
      setConfirming(false);
    }
  }

  const itemCls = "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors";

  return (
    <div className="flex items-center justify-center">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Actions for ${botName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Actions"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex size-8 items-center justify-center rounded-lg border text-muted transition-colors hover:border-accent/50 hover:text-accent",
          open ? "border-accent/50 text-accent" : "border-line",
        )}
      >
        <DotsIcon className="size-4" />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: rect.top, left: rect.left, width: MENU_WIDTH }}
            className="z-50 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg shadow-black/40"
          >
            <Link
              href={`/admin/bots/${botId}`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(itemCls, "text-white hover:bg-accent/10")}
            >
              <EyeIcon className="size-4 text-muted" />
              View details
            </Link>
            <Link
              href={`/admin/bots/${botId}/edit`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(itemCls, "text-white hover:bg-accent/10")}
            >
              <PencilIcon className="size-4 text-muted" />
              Edit / update
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setConfirming(true);
              }}
              className={cn(itemCls, "text-red-400 hover:bg-red-500/10")}
            >
              <TrashIcon className="size-4" />
              Delete
            </button>
          </div>,
          document.body,
        )}

      <ConfirmDialog
        open={confirming}
        title={`Delete ${botName}?`}
        description="This permanently removes the bot, its backtest results, and its change history. This can't be undone."
        confirmLabel="Delete bot"
        pending={pending}
        onConfirm={onDelete}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
