"use client";

import { useEffect, useRef, useState } from "react";
import type { SubtitleOption } from "./SubtitleSelector";

export type AudioOption = { index: number; label: string; isDefault: boolean };

/**
 * Audio and subtitles in one panel, from a speech-bubble button in the bottom
 * bar -- the Netflix layout Jake asked for (2026-09-29), sitting just left of
 * "next episode". Replaces the subtitle-only chip that used to sit in the top
 * bar: with audio now choosable too (sub vs dub), one place for both reads
 * better than two controls at opposite corners.
 *
 * Omitted entirely when there is nothing to choose: one audio track and no
 * subtitles.
 */
export function PlaybackOptionsMenu({
  audioTracks,
  selectedAudio,
  onAudio,
  subtitleTracks,
  selectedSubtitle,
  onSubtitle,
}: {
  audioTracks: AudioOption[];
  selectedAudio: number | null;
  onAudio: (index: number) => void;
  subtitleTracks: SubtitleOption[];
  selectedSubtitle: number | null;
  onSubtitle: (index: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  if (audioTracks.length < 2 && subtitleTracks.length === 0) return null;

  const row = (active: boolean) =>
    `flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
      active ? "text-white" : "text-white/60 hover:bg-white/10 hover:text-white"
    }`;
  const check = (active: boolean) => (
    <span className={`w-4 shrink-0 text-center ${active ? "opacity-100" : "opacity-0"}`} aria-hidden>
      ✓
    </span>
  );

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Audio and subtitles"
        aria-expanded={open}
        title="Audio and subtitles"
        className="flex touch-manipulation items-center"
      >
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 10h8M8 14h5M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.83L3 20l1.4-3.72A7.6 7.6 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Audio and subtitles"
          className="absolute bottom-full right-0 z-30 mb-3 flex max-h-[60vh] w-[min(34rem,calc(100vw-2rem))] gap-4 overflow-y-auto rounded-lg border border-white/10 bg-black/90 p-4 shadow-2xl backdrop-blur"
        >
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Audio</p>
            {audioTracks.length === 0 ? (
              <p className="px-2 text-sm text-white/40">Default</p>
            ) : (
              audioTracks.map((t) => (
                <button
                  key={t.index}
                  type="button"
                  className={row(t.index === selectedAudio)}
                  onClick={() => {
                    onAudio(t.index);
                    setOpen(false);
                  }}
                >
                  {check(t.index === selectedAudio)}
                  <span className="truncate">{t.label}</span>
                </button>
              ))
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">Subtitles</p>
            <button type="button" className={row(selectedSubtitle === null)} onClick={() => onSubtitle(null)}>
              {check(selectedSubtitle === null)}
              <span>Off</span>
            </button>
            {subtitleTracks.map((t) => (
              <button
                key={t.index}
                type="button"
                className={row(t.index === selectedSubtitle)}
                onClick={() => onSubtitle(t.index)}
              >
                {check(t.index === selectedSubtitle)}
                <span className="truncate">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
