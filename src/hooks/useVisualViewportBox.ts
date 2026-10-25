"use client";

import { useEffect, useState, type CSSProperties } from "react";

/**
 * The on-screen keyboard, on a phone, does not shrink 100dvh. iOS Safari
 * keeps the layout viewport where it was and scrolls the page so the focused
 * input is visible, which leaves a chat laid out for the full screen half
 * off it: the input somewhere in the middle, black below it, the keyboard
 * below that (2026-10-24, Jake's screenshot). Android Chrome does shrink the
 * viewport, but only with interactive-widget=resizes-content.
 *
 * window.visualViewport is the part of the page actually on screen, keyboard
 * excluded, on both. A one-screen page sized to it, pinned to the top of the
 * window, sits exactly above the keyboard: the composer snaps to the
 * keyboard's upper edge the way it does in the Claude and ChatGPT apps, and
 * the transcript keeps scrolling inside what is left. Safari's own scroll is
 * undone as it happens, which it tolerates because the input is already in
 * view.
 *
 * Returns the style for the page box and whether the keyboard is up: with it
 * up, the bottom safe-area inset (the home indicator) is under the keyboard,
 * so the page should stop padding for it.
 */
export function useVisualViewportBox(): { style: CSSProperties; keyboardOpen: boolean } {
  const [box, setBox] = useState<{ height: number | null; keyboardOpen: boolean }>({ height: null, keyboardOpen: false });

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Keyboards are hundreds of px; browser toolbars showing and hiding
        // are a few tens, and those still get the full height.
        const keyboardOpen = window.innerHeight - vv.height > 120;
        setBox((b) => (b.height === vv.height && b.keyboardOpen === keyboardOpen ? b : { height: vv.height, keyboardOpen }));
        if (keyboardOpen && (window.scrollY !== 0 || vv.offsetTop !== 0)) window.scrollTo(0, 0);
      });
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    window.addEventListener("orientationchange", update);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  const style: CSSProperties & Record<"--safe-bottom", string> = {
    // Until the first measurement (and on the server) 100dvh is right.
    height: box.height != null ? `${box.height}px` : "100dvh",
    "--safe-bottom": box.keyboardOpen ? "0px" : "env(safe-area-inset-bottom, 0px)",
  };
  return { style, keyboardOpen: box.keyboardOpen };
}
