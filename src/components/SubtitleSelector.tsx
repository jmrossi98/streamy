"use client";

import { useEffect, useRef, useState } from "react";

export type SubtitleOption = { index: number; label: string };

/** CC toggle + dropdown for subtitles. Was a row of inline buttons, one per
 * track -- fine for two or three languages, but a title with a full language
 * list (streamy-app.com serves plenty of those) pushed the whole top bar off
 * the edge of the player. A dropdown holds any number of tracks in the same
 * footprint as a single button. Omitted from the chrome entirely when a
 * title has no subtitle tracks -- see the players. */
export function SubtitleSelector({
  tracks,
  value,
  onChange,
  className = "",
}: {
  tracks: SubtitleOption[];
  value: number | null;
  onChange: (index: number | null) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const activeLabel = value == null ? null : tracks.find((t) => t.index === value)?.label;

  return (
    <div ref={rootRef} className={`pointer-events-auto relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={activeLabel ?? "Subtitles"}
        className={`flex min-h-[32px] items-center justify-center gap-1 rounded-full px-3 py-1 text-xs font-semibold tracking-wide backdrop-blur-sm transition-colors touch-manipulation ${
          value != null ? "bg-white text-netflix-black" : "bg-black/70 text-white/70 hover:text-white"
        }`}
      >
        <CcIcon />
        {activeLabel && <span className="max-w-[5rem] truncate">{activeLabel}</span>}
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Subtitles"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-30 max-h-64 w-48 overflow-y-auto rounded-lg bg-black/90 py-1 shadow-xl backdrop-blur-sm"
        >
          <button
            type="button"
            role="option"
            aria-selected={value === null}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={`block w-full truncate px-3 py-2 text-left text-xs font-medium touch-manipulation ${
              value === null ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            Off
          </button>
          {tracks.map((t) => {
            const active = t.index === value;
            return (
              <button
                key={t.index}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(t.index);
                  setOpen(false);
                }}
                className={`block w-full truncate px-3 py-2 text-left text-xs font-medium touch-manipulation ${
                  active ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The two "c" glyphs sit inside the box, centred on it. Worth stating the
 * geometry, because the previous path looked plausible but measurably wasn't:
 * its glyphs spanned x 5.0-16.5 (centre 10.7) inside a box spanning 3-21
 * (centre 12), leaving them visibly ~1.3 units left of centre, and sat 0.3
 * low. The starts below (8.8 / 17.8, y 10.2) put the pair's real extent --
 * curve bulge included, not just the endpoints -- at 6.25-17.8 horizontally
 * and 9.75-14.25 vertically, both centred on 12. */
function CcIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M8.8 10.2c-.6-.6-1.5-.6-2.1 0s-.6 3 0 3.6 1.5.6 2.1 0M17.8 10.2c-.6-.6-1.5-.6-2.1 0s-.6 3 0 3.6 1.5.6 2.1 0" />
    </svg>
  );
}
