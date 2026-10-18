/**
 * Playback events -> an hourly trend. Pure.
 *
 * The Viewers panel judges one session at a time; this answers the other
 * question: is playback getting worse for everyone, and when. Built from the
 * same PlaybackEvent rows (usePlaybackTelemetry): "start" when a player
 * begins, "playing" with the time to first picture, "stall" with its length,
 * "error".
 */

export type TrendEvent = { at: number; kind: string; ms: number | null };

export type TrendBucket = {
  /** Epoch ms of the hour's start. */
  start: number;
  starts: number;
  stalls: number;
  errors: number;
  /** Total time viewers spent staring at a spinner this hour. */
  stallSeconds: number;
  medianStartMs: number | null;
};

export type TrendSummary = {
  starts: number;
  stalls: number;
  errors: number;
  stallSeconds: number;
  /** Stalls per ten starts, the rate the panel badges; null without any starts. */
  stallsPerTenStarts: number | null;
  /** The hour with the most stall time, when any hour had a stall. */
  worst: TrendBucket | null;
};

const HOUR = 3_600_000;

/** `hours` buckets ending at the current hour, oldest first; empty hours are present as zeros. */
export function hourlyTrend(events: TrendEvent[], now: number, hours = 24): TrendBucket[] {
  const lastStart = Math.floor(now / HOUR) * HOUR;
  const firstStart = lastStart - (hours - 1) * HOUR;
  const buckets: TrendBucket[] = [];
  const startTimes: number[][] = [];
  for (let i = 0; i < hours; i++) {
    buckets.push({ start: firstStart + i * HOUR, starts: 0, stalls: 0, errors: 0, stallSeconds: 0, medianStartMs: null });
    startTimes.push([]);
  }
  for (const e of events) {
    const i = Math.floor((e.at - firstStart) / HOUR);
    if (i < 0 || i >= hours) continue;
    const b = buckets[i];
    if (e.kind === "start") b.starts++;
    else if (e.kind === "stall") {
      b.stalls++;
      b.stallSeconds += (e.ms ?? 0) / 1000;
    } else if (e.kind === "error") b.errors++;
    else if (e.kind === "playing" && e.ms != null) startTimes[i].push(e.ms);
  }
  buckets.forEach((b, i) => {
    b.stallSeconds = Math.round(b.stallSeconds);
    b.medianStartMs = median(startTimes[i]);
  });
  return buckets;
}

export function trendSummary(buckets: TrendBucket[]): TrendSummary {
  const sum = (k: "starts" | "stalls" | "errors" | "stallSeconds") => buckets.reduce((a, b) => a + b[k], 0);
  const starts = sum("starts");
  const stalls = sum("stalls");
  let worst: TrendBucket | null = null;
  for (const b of buckets) {
    if (b.stalls > 0 && (!worst || b.stallSeconds > worst.stallSeconds)) worst = b;
  }
  return {
    starts,
    stalls,
    errors: sum("errors"),
    stallSeconds: sum("stallSeconds"),
    stallsPerTenStarts: starts > 0 ? Math.round((stalls / starts) * 100) / 10 : null,
    worst,
  };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
