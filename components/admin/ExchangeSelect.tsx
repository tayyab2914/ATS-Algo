"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "@/components/admin/admin-icons";
import { BOT_EXCHANGES } from "@/lib/bot-exchanges";
import { cn } from "@/lib/cn";

type MenuRect = { top: number; left: number; width: number };

/**
 * Logo-bearing exchange picker. Native <select> can't render images in its
 * options, so this is a custom dropdown styled to match the form's inputs. The
 * menu renders in a portal with fixed positioning so it's never clipped by an
 * ancestor's `overflow-hidden` (e.g. the AdminCard glow container).
 */
export function ExchangeSelect({
  value,
  onChange,
  placeholder = "Select an exchange",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<MenuRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const selected = BOT_EXCHANGES.find((e) => e.value === value);

  // Position the menu under the trigger, matching its width.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom + 4, left: r.left, width: r.width });
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-[42px] w-full items-center justify-between gap-2 rounded-lg border border-line bg-background px-3 text-sm text-white focus:border-accent/60 focus:outline-none"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={selected.logo} alt="" width={20} height={20} className="size-5 shrink-0 rounded" />
              <span className="truncate">{selected.label}</span>
            </>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </span>
        <ChevronDownIcon className={cn("size-4 shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open &&
        rect &&
        createPortal(
          <ul
            ref={menuRef}
            role="listbox"
            style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }}
            className="z-50 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg shadow-black/40"
          >
            {BOT_EXCHANGES.map((ex) => (
              <li key={ex.value} role="option" aria-selected={ex.value === value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(ex.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/10",
                    ex.value === value ? "text-white" : "text-muted",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={ex.logo} alt="" width={20} height={20} className="size-5 shrink-0 rounded" />
                  <span>{ex.label}</span>
                  {ex.value === value && <span className="ml-auto text-accent">✓</span>}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
