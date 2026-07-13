"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BOT_EXCHANGES, type BotExchange } from "@/lib/bot-exchanges";
import { cn } from "@/lib/cn";

/** Overlapping logos to show before collapsing the rest into a "+N" circle. */
const MAX_VISIBLE = 3;

/**
 * A bot's allowed exchanges as an overlapping logo stack (avatar-group style) —
 * fixed, compact size no matter how many. Hovering reveals a portaled popover
 * listing every exchange by logo + name, so it's readable without widening the
 * row. The popover portals to <body> so the table's scroll can't clip it.
 */
export function ExchangeCluster({ exchanges }: { exchanges: string[] }) {
  const metas = exchanges
    .map((e) => BOT_EXCHANGES.find((b) => b.value.toLowerCase() === e.toLowerCase()))
    .filter((m): m is BotExchange => Boolean(m));

  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !ref.current) {
      setPos(null);
      return;
    }
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
  }, [open]);

  if (metas.length === 0) return <span className="text-muted">—</span>;

  // A single exchange reads best as a plain logo + name; the stack is for 2+.
  if (metas.length === 1) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={metas[0].logo} alt="" width={18} height={18} className="size-[18px] shrink-0 rounded" />
        {metas[0].label}
      </span>
    );
  }

  const visible = metas.slice(0, MAX_VISIBLE);
  const extra = metas.length - visible.length;

  return (
    <span
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      className="relative inline-flex cursor-default items-center"
    >
      {visible.map((m, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={m.value}
          src={m.logo}
          alt={m.label}
          width={24}
          height={24}
          className={cn("size-6 rounded-full bg-surface ring-2 ring-surface", i > 0 && "-ml-2.5")}
          style={{ zIndex: visible.length - i }}
        />
      ))}
      {extra > 0 && (
        <span className="-ml-2.5 z-0 flex size-6 items-center justify-center rounded-full bg-line text-[10px] font-semibold text-white ring-2 ring-surface">
          +{extra}
        </span>
      )}

      {open &&
        pos &&
        createPortal(
          <span
            style={{ position: "fixed", top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
            className="z-50 flex max-h-64 flex-col gap-2 overflow-auto rounded-xl border border-line bg-surface p-2.5 shadow-lg shadow-black/40"
          >
            {metas.map((m) => (
              <span key={m.value} className="inline-flex items-center gap-2 whitespace-nowrap text-xs text-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.logo} alt="" width={16} height={16} className="size-4 shrink-0 rounded" />
                {m.label}
              </span>
            ))}
          </span>,
          document.body,
        )}
    </span>
  );
}
