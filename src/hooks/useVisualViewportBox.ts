"use client";

import { useEffect, useState, type CSSProperties } from "react";

/**
 * The on-screen keyboard, on a phone, does not shrink 100dvh. iOS Safari
 * keeps the layout viewport where it was and pans the visual viewport down
 * it so the focused input shows, which leaves a chat laid out for the full
 * screen half off it: the input somewhere in the middle, black below it, the
 * keyboard below that (2026-10-24, Jake's screenshots). Android Chrome does
 * shrink the viewport, but only with interactive-widget=resizes-content.
 *
 * window.visualViewport is the part of the page actually on screen, keyboard
 * excluded, on both. A one-screen page sized to it sits exactly above the
 * keyboard: the composer snaps to the keyboard's upper edge the way it does
 * in the Claude and ChatGPT apps, and the transcript keeps scrolling inside
 * what is left.
 *
 * Three things learnt the hard way, each a screenshot:
 *
 *  - Safari pans *after* the keyboard has animated up, against where the
 *    input was then. Shrinking the box on the visualViewport resize is too
 *    late: the pan has happened, and following it with `top` chases it a
 *    frame behind (the shake). So the box shrinks the moment an input is
 *    focused, to the keyboard height measured last time (remembered per
 *    device in localStorage): the input is already in view when Safari
 *    looks, and it has nothing to pan. The first keyboard ever still pans
 *    once; `top` follows offsetTop for that case.
 *  - A pan is not a document scroll: with the document locked, scrollTo(0,0)
 *    does nothing to it. Only `top` can answer it.
 *  - The keyboard closing does not reliably deliver settled values: not in a
 *    final event, and not to a frame loop either -- the box kept a keyboard
 *    height and a leftover pan offset after the keyboard had gone (Jake's
 *    third set of screenshots). So the close side does not measure at all.
 *    A soft keyboard exists only for a focused field: the moment nothing
 *    editable has focus, the box is the full screen at top 0, and the
 *    measurements are only ever consulted while something is focused. The
 *    poll after a change runs on a timer, not requestAnimationFrame, which
 *    iOS pauses through its own animations.
 *  - While a field is focused the viewport readings wobble for a while
 *    (the keyboard animating, the predictive bar, Safari nudging the caret
 *    into view), and a box that re-laid itself out to every reading shook
 *    for seconds. A measured geometry is applied only once two polls in a
 *    row agree on it; the pre-shrink and the full screen are exact and go
 *    straight in. The document scroll is only put back on blur -- undoing
 *    it under Safari while it is still placing the caret is a tug of war.
 *
 * Returns the style for the page box and whether the keyboard is up: with it
 * up, the bottom safe-area inset (the home indicator) is under the keyboard,
 * so the page should stop padding for it.
 */
export function useVisualViewportBox(): { style: CSSProperties; keyboardOpen: boolean } {
  const [box, setBox] = useState<Box>(FULL);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    let settleUntil = 0;
    let editing = isEditable(document.activeElement);
    // Shrink ahead of the keyboard only until the settle loop has run its
    // course without one appearing: a hardware keyboard (an iPad with a
    // Magic Keyboard) focuses fields without taking any room.
    let preShrink = false;
    let sawKeyboard = false;
    // The last measured geometry, applied only when the next poll repeats it.
    let pending: Box | null = null;

    const apply = (next: Box) => {
      setBox((b) => (sameBox(b, next) ? b : next));
    };

    const measure = () => {
      const kb = Math.round(window.innerHeight - vv.height);
      // Keyboards are hundreds of px; browser toolbars showing and hiding
      // are a few tens, and those still get the full height.
      const keyboardOpen = kb > KEYBOARD_MIN_PX;
      if (!editing) {
        // Nothing focused, so no keyboard, whatever the viewport reports
        // mid-animation.
        pending = null;
        apply(FULL);
        if (window.scrollY !== 0) window.scrollTo(0, 0);
        return;
      }
      if (keyboardOpen) {
        sawKeyboard = true;
        const measured: Box = { height: Math.round(vv.height), top: Math.max(0, Math.round(vv.offsetTop)), keyboardOpen: true };
        if (pending && sameBox(pending, measured)) {
          rememberKeyboard(kb);
          apply(measured);
        } else {
          pending = measured;
        }
        return;
      }
      pending = null;
      if (preShrink && rememberedKeyboard() != null) {
        // Focused, keyboard still on its way up: take its room away now.
        apply({ height: window.innerHeight - (rememberedKeyboard() as number), top: 0, keyboardOpen: true });
      } else {
        apply(FULL);
      }
    };

    // Re-measure on a timer until the keyboard animation is surely over:
    // the events come at its start, the numbers settle at its end.
    const tick = () => {
      measure();
      if (performance.now() < settleUntil) return;
      if (timer) clearInterval(timer);
      timer = null;
      if (preShrink && !sawKeyboard) {
        preShrink = false;
        measure();
      }
    };
    const settle = () => {
      settleUntil = performance.now() + SETTLE_MS;
      measure();
      if (!timer) timer = setInterval(tick, POLL_MS);
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
      editing = true;
      preShrink = true;
      sawKeyboard = false;
      settle();
    };
    const onFocusOut = () => {
      // Focus may be moving to another field (an edit box in the transcript);
      // decide once it has landed.
      setTimeout(() => {
        editing = isEditable(document.activeElement);
        settle();
      }, 0);
    };

    settle();
    vv.addEventListener("resize", settle);
    vv.addEventListener("scroll", settle);
    window.addEventListener("orientationchange", settle);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      if (timer) clearInterval(timer);
      vv.removeEventListener("resize", settle);
      vv.removeEventListener("scroll", settle);
      window.removeEventListener("orientationchange", settle);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
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

type Box = { height: number | null; top: number; keyboardOpen: boolean };

function sameBox(a: Box, b: Box): boolean {
  return a.height === b.height && a.top === b.top && a.keyboardOpen === b.keyboardOpen;
}

const FULL: Box = { height: null, top: 0, keyboardOpen: false };
const KEYBOARD_MIN_PX = 120;
/** Longer than iOS's keyboard animation (~250 ms) with room for a slow frame. */
const SETTLE_MS = 700;
const POLL_MS = 50;
/** The keyboard's height last time it opened, per viewport width (portrait vs landscape). */
const KEYBOARD_KEY = "streamy.keyboard.height.v1";

function isEditable(el: EventTarget | Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !["button", "checkbox", "radio", "submit", "range", "file"].includes(el.type);
  return el.isContentEditable;
}

function keyboardKey(): string {
  return `${KEYBOARD_KEY}:${window.innerWidth}`;
}

function rememberedKeyboard(): number | null {
  try {
    const n = Number(window.localStorage.getItem(keyboardKey()));
    return n > KEYBOARD_MIN_PX ? n : null;
  } catch {
    return null;
  }
}

function rememberKeyboard(px: number) {
  try {
    if (rememberedKeyboard() !== px) window.localStorage.setItem(keyboardKey(), String(px));
  } catch {
    // Without storage the first focus each visit pans once; the rest is unaffected.
  }
}
