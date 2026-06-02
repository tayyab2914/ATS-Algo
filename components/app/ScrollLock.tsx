"use client";

import { useEffect } from "react";

/**
 * Disables page scrolling while mounted (and restores it on unmount). Rendered
 * inside the locked-tab overlay so a signed-out visitor can't scroll the
 * blurred preview behind the modal.
 */
export function ScrollLock() {
  useEffect(() => {
    const html = document.documentElement;
    const { overflow: prevHtml } = html.style;
    const { overflow: prevBody } = document.body.style;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
    };
  }, []);

  return null;
}
