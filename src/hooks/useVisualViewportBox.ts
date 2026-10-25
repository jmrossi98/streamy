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
 * excluded, on both. A one-screen page sized *and positioned* to it sits
 * exactly above the keyboard: the composer snaps to the keyboard's upper edge
 * the way it does in the Claude and ChatGPT apps, and the transcript keeps
 * scrolling inside what is left.
 *
 * Positioned, not just sized: a fixed element is laid out against the layout
 * viewport, and when the focused input is under the keyboard iOS pans the
 * visual viewport down the layout viewport to show it (offsetTop > 0). That
 * pan is not a document scroll -- with the document locked, scrollTo(0, 0)
 * does nothing to it -- so a box pinned to top:0 was carried off the top of
 * the screen, composer and all, the moment the keyboard opened (2026-10-24,
 * Jake's second screenshot: the input under the URL bar, black below). The
 * box's top follows offsetTop instead, so wherever Safari pans, the box
 * covers exactly what is on screen.
 *
 * Returns the style for the page box and whether the keyboard is up: with it
 * up, the bottom safe-area inset (the home indicator) is under the keyboard,
 * so the page should stop padding for it.
 */
export function useVisualViewportBox(): { style: CSSProperties; keyboardOpen: boolean } {
  const [box, setBox] = useState<{ height: number | null; top: number; keyboardOpen: boolean }>({
    height: null,
    top: 0,
    keyboardOpen: false,
  });

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
        const top = Math.max(0, Math.round(vv.offsetTop));
        const height = Math.round(vv.height);
        setBox((b) => (b.height === height && b.top === top && b.keyboardOpen === keyboardOpen ? b : { height, top, keyboardOpen }));
        // A real document scroll (the locked document still has a few px of
        // give in some states) is put back; the visual-viewport pan is
        // followed by `top` instead.
        if (window.scrollY !== 0) window.scrollTo(0, 0);
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
    top: box.top,
    "--safe-bottom": box.keyboardOpen ? "0px" : "env(safe-area-inset-bottom, 0px)",
  };
  return { style, keyboardOpen: box.keyboardOpen };
}
