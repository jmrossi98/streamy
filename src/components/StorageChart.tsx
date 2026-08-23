export type StorageChartProps = {
  totalSpace: number;
  freeSpace: number;
  moviesSize: number;
  tvSize: number;
};

// Palette slots 1/2/3 (blue/orange/aqua, dark steps) — validated for this
// chart's dark surface (#141414) via the dataviz skill's validator: all
// adjacent-pair CVD/normal-vision/contrast checks pass. Free space is
// deliberately NOT a categorical color — it's the absence of data, not a
// series, so it stays a neutral surface-adjacent gray.
const COLORS = {
  movies: "#3987e5",
  tv: "#d95926",
  other: "#199e70",
  free: "#3a3a3a",
} as const;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 GB";
  const gb = bytes / 1024 ** 3;
  return gb >= 1000 ? `${(gb / 1024).toFixed(1)} TB` : `${gb.toFixed(1)} GB`;
}

const RADIUS = 70;
const STROKE = 32;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const GAP = 4; // surface-color gap between segments, per the dataviz skill's spacer rule
// A segment representing real, nonzero data can round down to an
// imperceptible sliver against a mostly-empty disk (e.g. 1.5% of the ring).
// Floor its rendered arc length so it stays visible; the legend/tooltip
// still show the real byte count and percent, only the arc's pixels shift.
const MIN_ARC_LENGTH = 6;

export function StorageChart({ totalSpace, freeSpace, moviesSize, tvSize }: StorageChartProps) {
  if (!totalSpace) {
    return <p className="text-white/50 text-sm">Storage info unavailable.</p>;
  }

  const other = Math.max(totalSpace - freeSpace - moviesSize - tvSize, 0);
  const segments = [
    { key: "movies", label: "Movies", value: moviesSize, color: COLORS.movies },
    { key: "tv", label: "TV Shows", value: tvSize, color: COLORS.tv },
    { key: "other", label: "Other", value: other, color: COLORS.other },
    { key: "free", label: "Free space", value: freeSpace, color: COLORS.free },
  ].filter((s) => s.value > 0);

  const rawLengths = segments.map((s) => (s.value / totalSpace) * CIRCUMFERENCE);
  const deficit = rawLengths.reduce(
    (sum, len, i) => (segments[i].key !== "free" && len < MIN_ARC_LENGTH + GAP ? sum + (MIN_ARC_LENGTH + GAP - len) : sum),
    0
  );
  const freeIndex = segments.findIndex((s) => s.key === "free");
  if (freeIndex !== -1 && deficit > 0) {
    rawLengths[freeIndex] = Math.max(rawLengths[freeIndex] - deficit, MIN_ARC_LENGTH + GAP);
  }

  let cumulative = 0;
  const arcs = segments.map((s, i) => {
    const fraction = s.value / totalSpace;
    const rawLength = s.key !== "free" ? Math.max(rawLengths[i], MIN_ARC_LENGTH + GAP) : rawLengths[i];
    const length = Math.max(rawLength - GAP, 0);
    const offset = -cumulative;
    cumulative += rawLength;
    return { ...s, length, offset, percent: fraction * 100 };
  });

  const usedPercent = ((totalSpace - freeSpace) / totalSpace) * 100;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0">
        <svg width={180} height={180} viewBox="0 0 200 200" className="-rotate-90">
          <circle cx={100} cy={100} r={RADIUS} fill="none" stroke="#232323" strokeWidth={STROKE} />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={100}
              cy={100}
              r={RADIUS}
              fill="none"
              stroke={a.color}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${a.length} ${CIRCUMFERENCE - a.length}`}
              strokeDashoffset={a.offset}
            >
              <title>
                {a.label}: {formatBytes(a.value)} ({a.percent.toFixed(1)}%)
              </title>
            </circle>
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-white text-2xl font-bold">{usedPercent.toFixed(0)}%</span>
          <span className="text-white/50 text-xs">used</span>
        </div>
      </div>

      <ul className="flex flex-col gap-2 min-w-[180px]">
        {arcs.map((a) => (
          <li key={a.key} className="flex items-center gap-2 text-sm">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: a.color }}
              aria-hidden
            />
            <span className="text-white/90">{a.label}</span>
            <span className="text-white/50 ml-auto tabular-nums">{formatBytes(a.value)}</span>
          </li>
        ))}
        <li className="pt-2 mt-1 border-t border-white/10 flex items-center gap-2 text-sm">
          <span className="text-white/50">Total</span>
          <span className="text-white/70 ml-auto tabular-nums">{formatBytes(totalSpace)}</span>
        </li>
      </ul>
    </div>
  );
}
