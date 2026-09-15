/**
 * Disk usage on mediabox, read from a JSON snapshot rather than asked of
 * Radarr.
 *
 * `/api/v3/diskspace` was always just `df`, and the movie-size figure was
 * always just `du` over files Radarr happened to know about -- but the panel
 * went dark every time Radarr had a bad night, and none of those nights were
 * ever actually about disk space. This reads the same numbers from a file a
 * cron job on mediabox writes directly, independent of every *arr app.
 *
 * Served by the same nginx container as the Flash library share, at a
 * separate path -- see FLASH_LIBRARY_URL and its own health check in
 * serviceStatus.ts, which this reuses rather than adding a second env var for
 * what is physically the same service.
 */

const PROBE_TIMEOUT_MS = 6_000;

export type DiskUsage = {
  totalBytes: number;
  freeBytes: number;
  categories: {
    movies: number;
    tv: number;
    roms: number;
    torrents: number;
  };
  generatedAt: string;
};

function baseUrl(): string {
  return process.env.FLASH_LIBRARY_URL?.replace(/\/$/, "") ?? "";
}

export function isDiskUsageConfigured(): boolean {
  return !!baseUrl();
}

/** Null when unconfigured, unreachable, or the snapshot doesn't parse. */
export async function getDiskUsage(): Promise<DiskUsage | null> {
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/status/disk-usage.json`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<DiskUsage> | null;
    if (
      !body ||
      typeof body.totalBytes !== "number" ||
      typeof body.freeBytes !== "number" ||
      !body.categories
    ) {
      return null;
    }
    return {
      totalBytes: body.totalBytes,
      freeBytes: body.freeBytes,
      categories: {
        movies: body.categories.movies ?? 0,
        tv: body.categories.tv ?? 0,
        roms: body.categories.roms ?? 0,
        torrents: body.categories.torrents ?? 0,
      },
      generatedAt: body.generatedAt ?? "",
    };
  } catch {
    return null;
  }
}
