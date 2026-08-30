"use client";

export type SubtitleOption = { index: number; label: string };

/** Track-picker for subtitles, styled to match QualitySelector. Omitted from
 * the chrome entirely when a title has no subtitle tracks -- see the players. */
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
  return (
    <div
      className={`pointer-events-auto inline-flex items-center gap-0.5 rounded-full bg-black/70 p-0.5 backdrop-blur-sm ${className}`}
      role="radiogroup"
      aria-label="Subtitles"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        title="Subtitles off"
        onClick={() => onChange(null)}
        className={`flex min-h-[32px] items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-colors touch-manipulation ${
          value === null ? "bg-white text-netflix-black" : "text-white/70 hover:text-white"
        }`}
      >
        <CcIcon />
      </button>
      {tracks.map((t) => {
        const active = t.index === value;
        return (
          <button
            key={t.index}
            type="button"
            role="radio"
            aria-checked={active}
            title={t.label}
            onClick={() => onChange(t.index)}
            className={`min-h-[32px] max-w-[6rem] truncate rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-colors touch-manipulation ${
              active ? "bg-white text-netflix-black" : "text-white/70 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function CcIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M7.5 10.5c-.6-.6-1.5-.6-2.1 0s-.6 3 0 3.6 1.5.6 2.1 0M16.5 10.5c-.6-.6-1.5-.6-2.1 0s-.6 3 0 3.6 1.5.6 2.1 0" />
    </svg>
  );
}
