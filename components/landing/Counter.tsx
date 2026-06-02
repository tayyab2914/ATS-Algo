"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Count-up number that animates from 0 to `value` the first time it enters the
 * viewport. Decimals are inferred from the target (e.g. `99.9` keeps one place)
 * and the integer part is thousands-grouped. Respects reduced-motion by
 * jumping straight to the final value.
 */
export function Counter({
  value,
  prefix = "",
  suffix = "",
  duration = 1600,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(0);
  const decimals = Number.isInteger(value) ? 0 : (value.toString().split(".")[1]?.length ?? 0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setDisplay(value));
      return () => cancelAnimationFrame(id);
    }

    let raf = 0;
    let start = 0;
    const run = (now: number) => {
      if (!start) start = now;
      const progress = Math.min((now - start) / duration, 1);
      // easeOutExpo for a snappy finish.
      const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplay(value * eased);
      if (progress < 1) raf = requestAnimationFrame(run);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          raf = requestAnimationFrame(run);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  const formatted = display.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
