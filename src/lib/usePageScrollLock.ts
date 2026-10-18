"use client";

import { useEffect } from "react";

/**
 * Stops the page behind a full-screen layer from scrolling while it is up.
 * The players cover the viewport with a fixed frame, but the page under them
 * kept its scroll bar, which showed down the side of the video both in and
 * out of fullscreen (reported 2026-10-17). Both html and body: which one
 * carries the scroll bar depends on the browser and the page's styles.
 */
export function usePageScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    const prev = [html.style.overflow, body.style.overflow];
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prev[0];
      body.style.overflow = prev[1];
    };
  }, [active]);
}
