"use client";

import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Scroll-reveal wrapper. Renders hidden (via the `.reveal` class) and adds
 * `.is-visible` the first time it scrolls into view, letting the CSS transition
 * fade + lift the content in. Honours `prefers-reduced-motion` through the
 * stylesheet, so no JS branch is needed for that.
 *
 * @param as    - Element/tag to render (default `div`).
 * @param delay - Optional stagger in ms applied as a transition-delay.
 */
export function Reveal({
  children,
  as,
  className,
  delay = 0,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  delay?: number;
}) {
  const Tag = as ?? "div";
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // Reveal immediately when the observer isn't available, or when the element
    // is already within the initial viewport. This guarantees above-the-fold
    // content (e.g. the hero) is never left stuck at opacity:0 waiting on — or
    // racing against — the observer's asynchronous first callback.
    if (
      typeof IntersectionObserver === "undefined" ||
      node.getBoundingClientRect().top < window.innerHeight
    ) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={cn("reveal", visible && "is-visible", className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
