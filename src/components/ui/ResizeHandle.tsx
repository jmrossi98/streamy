"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { clampSize, nudgeSize, parseStoredSize } from "@/lib/paneSizeRules";

type Props = {
  /** "vertical": a vertical bar that resizes a width. "horizontal": a horizontal bar that resizes a height. */
  orientation: "vertical" | "horizontal";
  label: string;
  /** The pane's current size in px, read when a drag or key press starts (it may be laid out by CSS, not set). */
  getSize: () => number;
  min: number;
  /** A number, or a function when the limit depends on layout (read when a drag or key press starts). */
  max: number | (() => number);
  onResize: (size: number) => void;
  /** Double-click: back to the default size. */
  onReset: () => void;
  className?: string;
};

/**
 * A draggable divider between two panes. Dragging right/down grows the pane
 * before it. Works with mouse, touch and pen (pointer events with capture),
 * and with the keyboard when focused: arrows nudge, Shift+arrow nudges more,
 * Home/End jump to the ends. The bar draws as a 1px line; the hit area around
 * it is wider so it's easy to grab.
 */
export function ResizeHandle({ orientation, label, getSize, min, max, onResize, onReset, className }: Props) {
  const drag = useRef<{ start: number; size: number; max: number } | null>(null);
  const [ariaMax, setAriaMax] = useState(typeof max === "number" ? max : min);
  const readMax = () => {
    const m = Math.max(min, typeof max === "number" ? max : max());
    setAriaMax(m);
    return m;
  };
  const [dragging, setDragging] = useState(false);
  const vertical = orientation === "vertical";

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: vertical ? e.clientX : e.clientY, size: getSize(), max: readMax() };
    setDragging(true);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const delta = (vertical ? e.clientX : e.clientY) - drag.current.start;
    onResize(clampSize(drag.current.size + delta, min, drag.current.max));
  }
  function endDrag(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = nudgeSize(getSize(), e.key, orientation, { min, max: readMax(), large: e.shiftKey });
    if (next == null) return;
    e.preventDefault();
    onResize(next);
  }

  // While dragging, keep the resize cursor everywhere and stop text selection.
  useEffect(() => {
    if (!dragging) return;
    const body = document.body.style;
    const prev = { cursor: body.cursor, userSelect: body.userSelect };
    body.cursor = vertical ? "col-resize" : "row-resize";
    body.userSelect = "none";
    return () => {
      body.cursor = prev.cursor;
      body.userSelect = prev.userSelect;
    };
  }, [dragging, vertical]);

  const line = vertical ? "inset-y-0 left-1/2 w-px -translate-x-1/2" : "inset-x-0 top-1/2 h-px -translate-y-1/2";
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={typeof max === "number" ? Math.max(min, max) : ariaMax}
      title={`${label}: drag to resize, double-click to reset`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={[
        "group relative z-10 shrink-0 touch-none select-none outline-none",
        vertical ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize",
        className ?? "",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "pointer-events-none absolute transition-colors group-hover:bg-white/35 group-focus-visible:bg-white/60",
          line,
          dragging ? "bg-white/60" : "bg-white/10",
        ].join(" ")}
      />
    </div>
  );
}

/**
 * A pane size remembered in localStorage. null means "the default" (laid out
 * by CSS). Read after mount so the server render and first client render
 * match; storage that throws (private mode, blocked) just isn't remembered.
 */
export function usePersistedSize(key: string, min: number, max: number): [number | null, (size: number | null) => void] {
  const [size, setSizeState] = useState<number | null>(null);
  useEffect(() => {
    try {
      setSizeState(parseStoredSize(window.localStorage.getItem(key), min, max));
    } catch {
      /* not remembered */
    }
  }, [key, min, max]);
  const setSize = useCallback(
    (next: number | null) => {
      setSizeState(next);
      try {
        if (next == null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, String(next));
      } catch {
        /* not remembered */
      }
    },
    [key]
  );
  return [size, setSize];
}
