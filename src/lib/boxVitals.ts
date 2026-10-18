/**
 * mediabox's vital signs, as published by scripts/box-vitals.py in
 * mediabox-infra to /data/status/box-vitals.json (served by the flash
 * container's nginx like the other status files -- see cronInventory.ts).
 *
 * Rewritten four times a minute on the box; cached here for a few seconds so
 * an admin tab polling every ten seconds and a second admin tab don't both go
 * across the tailnet for the same file.
 */

import { cached } from "./ttlCache";

const TIMEOUT_MS = 4_000;
const CACHE_MS = 5_000;
/** Older than this and the box's cron has stopped, or the box is off: say so rather than show old numbers as now. */
export const STALE_AFTER_S = 180;

export type BoxVitals = {
  generatedAt: string;
  sampleSeconds: number;
  cpu: { busyPct?: number; iowaitPct?: number; idlePct?: number; cores: number; load1: number; load5: number; temperatureC: number | null };
  memory: { totalBytes: number; availableBytes: number; swapUsedBytes: number };
  gpu: { utilPct: number; encoderPct: number; decoderPct: number; memoryUsedMB: number; nvencSessions: number; temperatureC: number } | null;
  ffmpeg: { live: number; vod: number; other: number };
  containers: { totalCores: number; top: { name: string; cpuPct: number }[] };
  net: {
    primary: { iface: string; rxMbps?: number; txMbps?: number };
    tailscale: { rxMbps: number; txMbps: number } | null;
  };
  disks: Record<string, { busyPct: number; readMBps: number; writeMBps: number }>;
  transcodeCache: { bytes: number; files: number } | null;
  zombies: number;
  streamPriority: {
    throttled: boolean;
    since: string | null;
    lastPlayingAt: string | null;
    secondsSincePlaying: number | null;
    loweredCpuWeight: string[];
    paused: string[];
    cancelledTasks: string[];
    sabSpeedLimited: boolean;
    sabDiskLimited: boolean;
    qbtDownloadLimited: boolean;
  } | null;
};

/** The driver on the 1050 Ti allows this many concurrent NVENC sessions (driver 580). */
export const NVENC_SESSION_LIMIT = 8;

export function isBoxVitalsConfigured(): boolean {
  return Boolean(process.env.FLASH_LIBRARY_URL);
}

/** Null when not configured, not yet written (404), unreachable or malformed. */
export async function getBoxVitals(): Promise<BoxVitals | null> {
  const base = process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "");
  if (!base) return null;
  return cached("box:vitals", CACHE_MS, async () => {
    try {
      const res = await fetch(`${base}/status/box-vitals.json`, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<BoxVitals>;
      if (typeof body?.generatedAt !== "string" || !body.cpu) return null;
      return body as BoxVitals;
    } catch {
      return null;
    }
  });
}

/** How old a reading is, in seconds; null when the stamp can't be read. */
export function vitalsAgeSeconds(v: BoxVitals | null, now = Date.now()): number | null {
  if (!v) return null;
  const t = Date.parse(v.generatedAt);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
}
