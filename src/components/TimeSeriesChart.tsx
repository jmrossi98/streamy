"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A small multi-series line chart over time, in plain SVG.
 *
 * No charting library, because this app has none and one chart is not worth
 * becoming a reason to add one -- the whole thing is an SVG path per series
 * plus a hover layer.
 *
 * Colours come from the validated categorical palette (blue / orange / aqua /
 * yellow), in fixed slot order. That order is the one that passes CVD
 * separation on this app's #181818 panel surface; picking prettier hues by
 * eye is exactly how a chart ends up unreadable for a deuteranopic viewer.
 * Series keep their slot regardless of how many are shown, so hiding one
 * never repaints the others.
 */

/**
 * Five validated categorical slots, in fixed order.
 *
 * Five rather than four because the temperature chart grew a GPU series and
 * would otherwise have cycled -- `i % length` quietly gives series five the
 * same blue as series one, which is worse than no colour at all. Every slot
 * passes the lightness band, chroma floor, CVD separation and contrast
 * checks against this app's #181818 panel surface; they are not eyeballed,
 * and a sixth series needs the validator run again rather than a guess.
 */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"] as const;

export type Series = {
  label: string;
  /** One value per point, null where the reading is genuinely unknown. */
  values: (number | null)[];
};

type Props = {
  /** ISO timestamps, one per index in every series. */
  times: string[];
  series: Series[];
  /**
   * Which formatter to use, as a string rather than a function.
   *
   * This took the admin page down once: ConnectionsPanel is a server
   * component and this is a client one, and a function cannot cross that
   * boundary -- React throws "Functions cannot be passed directly to Client
   * Components" at render time. Neither tsc nor next build catches it,
   * because it is a serialization rule, not a type error. A union of string
   * literals cannot fail that way.
   */
  unit: "bytesPerSecond" | "celsius" | "watts";
  height?: number;
  /** Forces the y-axis floor to 0. True for rates, false for temperatures. */
  zeroBased?: boolean;
};

const PAD = { top: 8, right: 8, bottom: 18, left: 44 };

const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
});

function formatBytesPerSecond(v: number): string {
  if (v < 1024) return `${Math.round(v)} B/s`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB/s`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}

const FORMATTERS: Record<Props["unit"], (v: number) => string> = {
  bytesPerSecond: formatBytesPerSecond,
  celsius: (v) => `${Math.round(v)}°C`,
  watts: (v) => `${v.toFixed(1)} W`,
};

export function TimeSeriesChart({
  times,
  series,
  unit,
  height = 240,
  zeroBased = true,
}: Props) {
  const format = FORMATTERS[unit];
  const [hover, setHover] = useState<number | null>(null);

  // The viewBox is measured, not fixed.
  //
  // This started as a fixed 720-unit viewBox with w-full and an explicit
  // pixel height, which letterboxes: preserveAspectRatio scales the box to
  // *fit* the container, the height is the binding constraint, and the chart
  // renders 720px wide floating in the middle of a 1900px panel with dead
  // space either side. Measuring the container and setting the viewBox to
  // its real width makes one unit one pixel -- the plot fills the space and
  // nothing is stretched, which preserveAspectRatio="none" would have done
  // to the text.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (times.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-white/30">
        Not enough history yet - the sampler runs every 5 minutes.
      </p>
    );
  }

  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const rawMax = all.length ? Math.max(...all) : 1;
  const rawMin = all.length ? Math.min(...all) : 0;
  const max = rawMax === rawMin ? rawMax + 1 : rawMax;
  const min = zeroBased ? 0 : Math.min(rawMin, max) - (max - rawMin) * 0.1;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (times.length - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  // Breaks the path at nulls rather than bridging them: a straight line
  // across a gap invents data that was never measured.
  const pathFor = (values: (number | null)[]): string => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const ticks = [min, min + (max - min) / 2, max];

  return (
    <div ref={wrapRef} className="space-y-2">
      {/* Legend is always present for 2+ series, so identity is never
          carried by colour alone. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {series.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5 text-white/60">
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
            />
            {s.label}
          </span>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block"
        role="img"
        aria-label={`Time series: ${series.map((s) => s.label).join(", ")}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * width;
          const i = Math.round(((px - PAD.left) / plotW) * (times.length - 1));
          setHover(i >= 0 && i < times.length ? i : null);
        }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="1"
            />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.35)">
              {format(t)}
            </text>
          </g>
        ))}

        <text x={PAD.left} y={height - 5} fontSize="9" fill="rgba(255,255,255,0.3)">
          {timeFmt.format(new Date(times[0]))}
        </text>
        <text x={width - PAD.right} y={height - 5} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.3)">
          {timeFmt.format(new Date(times[times.length - 1]))}
        </text>

        {series.map((s, i) => (
          <path
            key={s.label}
            d={pathFor(s.values)}
            fill="none"
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {hover !== null && (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth="1"
            />
            {series.map((s, i) => {
              const v = s.values[hover];
              if (v === null || v === undefined) return null;
              return (
                <circle
                  key={s.label}
                  cx={x(hover)}
                  cy={y(v)}
                  r="3.5"
                  fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                  stroke="#181818"
                  strokeWidth="2"
                />
              );
            })}
          </>
        )}
      </svg>

      {/* Tooltip as real DOM rather than SVG text: it wraps, it inherits the
          app's type, and it cannot be clipped by the viewBox. */}
      {hover !== null && (
        <div className="rounded border border-white/10 bg-netflix-dark px-2 py-1.5 text-xs">
          <p className="mb-1 text-white/40">
            {new Date(times[hover]).toLocaleString("en-US", {
              timeZone: "America/New_York",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            ET
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            {series.map((s, i) => {
              const v = s.values[hover];
              return (
                <span key={s.label} className="flex items-center gap-1.5 text-white/70">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }}
                  />
                  {s.label}: {v === null || v === undefined ? "-" : format(v)}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
