/**
 * Stream-load samples -> the history the admin Streaming tab shows. Pure.
 *
 * A sample is one minute's reading while anyone was on: how many players were
 * going, split live/VOD, and what the upload line carried. From those: the
 * busiest moment of each day (when does the fourth line start to matter) and
 * a day's load for the chart.
 */

import type { PlayingNow } from "./viewerActivityRules";

export type LoadSample = {
  at: number;
  playing: number;
  live: number;
  vod: number;
  proxyMbps: number;
  torrentUpMbps: number | null;
};

export type DailyPeak = {
  /** YYYY-MM-DD in the house's time zone. */
  day: string;
  peakPlaying: number;
  peakMbps: number;
  /** Minutes with at least one player going. */
  busyMinutes: number;
};

export const HOUSE_TIME_ZONE = "America/New_York";

/** The states that hold a stream open. Paused is out: nothing flows and the line slot is what matters. */
export function countPlaying(playing: (PlayingNow | null)[]): { playing: number; live: number; vod: number } {
  let live = 0;
  let vod = 0;
  for (const p of playing) {
    if (!p || !(p.state === "playing" || p.state === "buffering" || p.state === "tuning")) continue;
    if (p.kind === "live") live++;
    else vod++;
  }
  return { playing: live + vod, live, vod };
}

const dayFmt = new Map<string, Intl.DateTimeFormat>();
function dayKey(at: number, timeZone: string): string {
  let f = dayFmt.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFmt.set(timeZone, f);
  }
  return f.format(new Date(at));
}

/** One row per day that has samples, oldest first. */
export function dailyPeaks(samples: LoadSample[], timeZone = HOUSE_TIME_ZONE): DailyPeak[] {
  const byDay = new Map<string, DailyPeak>();
  for (const s of samples) {
    const day = dayKey(s.at, timeZone);
    const d = byDay.get(day) ?? { day, peakPlaying: 0, peakMbps: 0, busyMinutes: 0 };
    d.peakPlaying = Math.max(d.peakPlaying, s.playing);
    d.peakMbps = Math.max(d.peakMbps, s.proxyMbps);
    if (s.playing > 0) d.busyMinutes++;
    byDay.set(day, d);
  }
  return [...byDay.values()]
    .map((d) => ({ ...d, peakMbps: Math.round(d.peakMbps * 10) / 10 }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

/**
 * At most `maxPoints` samples, keeping each bin's busiest reading rather than
 * its average: the chart is there to show the peaks, and averaging a one-minute
 * spike into a five-minute bin is how a peak disappears.
 */
export function thinSamples(samples: LoadSample[], maxPoints: number): LoadSample[] {
  if (samples.length <= maxPoints) return samples;
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const span = sorted[sorted.length - 1].at - sorted[0].at || 1;
  const binMs = span / maxPoints;
  const out: LoadSample[] = [];
  let bin = -1;
  for (const s of sorted) {
    const b = Math.min(maxPoints - 1, Math.floor((s.at - sorted[0].at) / binMs));
    if (b !== bin) {
      out.push({ ...s });
      bin = b;
    } else {
      const cur = out[out.length - 1];
      cur.playing = Math.max(cur.playing, s.playing);
      cur.live = Math.max(cur.live, s.live);
      cur.vod = Math.max(cur.vod, s.vod);
      cur.proxyMbps = Math.max(cur.proxyMbps, s.proxyMbps);
      cur.torrentUpMbps = s.torrentUpMbps == null ? cur.torrentUpMbps : Math.max(cur.torrentUpMbps ?? 0, s.torrentUpMbps);
    }
  }
  return out;
}
