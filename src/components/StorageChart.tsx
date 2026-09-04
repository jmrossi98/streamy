export type StorageChartProps = {
  totalSpace: number;
  freeSpace: number;
  moviesSize: number;
  tvSize: number;
  /** Optional: omitted (not 0) when gamarr isn't configured, same as the
   *  other three genuinely can be zero without meaning "no data". */
  gamesSize?: number;
};

// Categorical slots for each content type, validated against this chart's
// dark surface (#141414) with the dataviz validator: lightness band, chroma
// floor, adjacent-pair CVD separation, normal-vision floor and contrast all
// pass. Games' magenta sits at a distinct hue from all three neighbors
// (blue/orange/green), so it stays separable from every existing slice, not
// just the one next to it. Free space is deliberately NOT categorical --
// it's the absence of data rather than a series, so it stays a neutral
// surface-adjacent gray.
const COLORS = {
  movies: "#3987e5",
  tv: "#d95926",
  games: "#c026d3",
  other: "#199e70",
  free: "#3a3a3a",
} as const;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 GB";
  const gb = bytes / 1024 ** 3;
  return gb >= 1000 ? `${(gb / 1024).toFixed(1)} TB` : `${gb.toFixed(1)} GB`;
}

// A real but small segment (a couple of GB against a nearly empty disk) would
// otherwise round to a sliver too thin to see or hover. Floor its rendered
// width; the labels still carry the true bytes and percentage.
const MIN_SEGMENT_PCT = 1.5;

export type StorageBar = {
  key: string;
  label: string;
  value: number;
  color: string;
  /** True share of the disk. */
  pct: number;
  /** Rendered width, floored so a real segment can't vanish. */
  width: number;
};

/**
 * Splits the disk into the segments the meter draws.
 *
 * "Other" is whatever the disk holds that Radarr and Sonarr don't account
 * for -- the OS, Docker, and any torrent data not shared with an imported
 * file -- so it's derived rather than reported.
 */
export function buildStorageSegments(
  totalSpace: number,
  freeSpace: number,
  moviesSize: number,
  tvSize: number,
  gamesSize: number = 0
): { bars: StorageBar[]; used: number; usedPercent: number; usedWidth: number } {
  const other = Math.max(totalSpace - freeSpace - moviesSize - tvSize - gamesSize, 0);
  const used = Math.max(totalSpace - freeSpace, 0);
  const usedPercent = totalSpace > 0 ? (used / totalSpace) * 100 : 0;

  const bars = [
    { key: "movies", label: "Movies", value: moviesSize, color: COLORS.movies },
    { key: "tv", label: "TV Shows", value: tvSize, color: COLORS.tv },
    { key: "games", label: "Games", value: gamesSize, color: COLORS.games },
    { key: "other", label: "Other", value: other, color: COLORS.other },
  ]
    .filter((s) => s.value > 0)
    .map((s) => {
      const pct = totalSpace > 0 ? (s.value / totalSpace) * 100 : 0;
      return { ...s, pct, width: Math.max(pct, MIN_SEGMENT_PCT) };
    });

  const usedWidth = bars.reduce((sum, b) => sum + b.width, 0);
  return { bars, used, usedPercent, usedWidth };
}

export function StorageChart({
  totalSpace,
  freeSpace,
  moviesSize,
  tvSize,
  gamesSize = 0,
}: StorageChartProps) {
  if (!totalSpace) {
    return <p className="text-white/50 text-sm">Storage info unavailable.</p>;
  }

  const { bars, used, usedPercent, usedWidth } = buildStorageSegments(
    totalSpace,
    freeSpace,
    moviesSize,
    tvSize,
    gamesSize
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-2">
          <span className="text-white text-3xl font-bold tabular-nums">
            {formatBytes(used)}
          </span>
          <span className="text-white/50 text-sm">of {formatBytes(totalSpace)} used</span>
        </div>
        <span className="text-white/70 text-sm tabular-nums">{usedPercent.toFixed(0)}%</span>
      </div>

      {/* Capacity meter: stacked fill against the full width of the disk. */}
      <div className="flex h-4 w-full overflow-hidden rounded-md bg-white/[0.07]">
        {bars.map((b, i) => (
          <div
            key={b.key}
            className="h-full"
            style={{
              width: `${b.width}%`,
              backgroundColor: b.color,
              // 2px surface gap between adjacent fills, per the mark spec.
              marginRight: i < bars.length - 1 ? 2 : 0,
            }}
            title={`${b.label}: ${formatBytes(b.value)} (${b.pct.toFixed(1)}%)`}
          />
        ))}
        <div
          className="h-full"
          style={{ width: `${Math.max(100 - usedWidth, 0)}%`, backgroundColor: COLORS.free }}
          title={`Free space: ${formatBytes(freeSpace)}`}
        />
      </div>

      {/* Legend doubles as the value table -- identity is never color-alone. */}
      <ul className="flex flex-col gap-2 text-sm">
        {bars.map((b) => (
          <li key={b.key} className="flex items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: b.color }}
              aria-hidden
            />
            <span className="text-white/90">{b.label}</span>
            <span className="ml-auto text-white/50 tabular-nums">{formatBytes(b.value)}</span>
            <span className="w-12 text-right text-white/40 tabular-nums">
              {b.pct.toFixed(1)}%
            </span>
          </li>
        ))}
        <li className="flex items-center gap-2.5 border-t border-white/10 pt-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: COLORS.free }}
            aria-hidden
          />
          <span className="text-white/70">Free</span>
          <span className="ml-auto text-white/50 tabular-nums">{formatBytes(freeSpace)}</span>
          <span className="w-12 text-right text-white/40 tabular-nums">
            {((freeSpace / totalSpace) * 100).toFixed(1)}%
          </span>
        </li>
      </ul>
    </div>
  );
}
