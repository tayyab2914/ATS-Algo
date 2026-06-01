"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/** Pill segmented control. Visual only — tracks a local active index. */
export function Segmented({ options, defaultIndex = 0 }: { options: string[]; defaultIndex?: number }) {
  const [active, setActive] = useState(defaultIndex);

  return (
    <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          onClick={() => setActive(index)}
          className={cn(
            "rounded-md px-3 py-1 text-xs leading-[18px] transition-colors",
            index === active ? "bg-accent font-medium text-[#121212]" : "text-muted hover:text-white",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
