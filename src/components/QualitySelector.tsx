"use client";

export type PlaybackQuality = "auto" | "4k" | "1080p";

const OPTIONS: { value: PlaybackQuality; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Best that plays smoothly" },
  { value: "4k", label: "4K", hint: "Full quality (needs bandwidth)" },
  { value: "1080p", label: "1080p", hint: "Smoother, transcoded" },
];

/**
 * Three-way playback quality control shown over the player.
 *  - Auto: direct-play the source file, fall back to a 1080p transcode if the
 *    browser can't decode it.
 *  - 4K: force direct-play of the source (no transcode).
 *  - 1080p: force Jellyfin to transcode down to H.264/1080p.
 *
 * "4K" here means "the source file as-is" -- for a 1080p title that's still the
 * best available, it just won't be higher than the source.
 */
export function QualitySelector({
  value,
  onChange,
  className = "",
}: {
  value: PlaybackQuality;
  onChange: (q: PlaybackQuality) => void;
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-auto inline-flex items-center gap-0.5 rounded-full bg-black/70 p-0.5 backdrop-blur-sm ${className}`}
      role="radiogroup"
      aria-label="Playback quality"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.hint}
            onClick={() => onChange(opt.value)}
            className={`min-h-[32px] rounded-full px-3 py-1 text-xs font-semibold tracking-wide transition-colors touch-manipulation ${
              active
                ? "bg-white text-netflix-black"
                : "text-white/70 hover:text-white"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
