"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Slim top progress bar for instant navigation feedback. It starts the moment a
 * user clicks an internal link and completes once the new route commits, so a
 * click never feels ignored even while the server streams. Pairs with each
 * route's `loading.tsx` skeleton.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [width, setWidth] = useState(0);
  const timers = useRef<number[]>([]);

  function clearTimers() {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }

  // Kick the bar off on a same-tab internal link click (the common case: sidebar
  // nav, in-page links). Programmatic navigations finish it via the path effect.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      if (!href.startsWith("/") || href.startsWith("//")) return; // internal only
      if (new URL(href, window.location.href).pathname === pathname) return; // same page
      clearTimers();
      setActive(true);
      setWidth(10);
      timers.current.push(window.setTimeout(() => setWidth(50), 80));
      timers.current.push(window.setTimeout(() => setWidth(80), 350));
      timers.current.push(window.setTimeout(() => setWidth(92), 900));
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  // The route changed → the navigation committed; fill and fade out. setState is
  // scheduled (not called synchronously in the effect body) to avoid cascading
  // renders.
  useEffect(() => {
    clearTimers();
    const fill = window.setTimeout(() => setWidth(100), 0);
    const hide = window.setTimeout(() => setActive(false), 220);
    const reset = window.setTimeout(() => setWidth(0), 480);
    return () => {
      window.clearTimeout(fill);
      window.clearTimeout(hide);
      window.clearTimeout(reset);
    };
  }, [pathname]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-0.5"
      style={{ opacity: active ? 1 : 0, transition: "opacity 250ms ease" }}
    >
      <div
        className="h-full bg-accent shadow-[0_0_10px_rgba(40,184,213,0.8)]"
        style={{ width: `${width}%`, transition: "width 350ms ease" }}
      />
    </div>
  );
}
