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

type Categories = {
  movies: number;
  tv: number;
  roms: number;
  torrents: number;
};

/**
 * One drive of the /data pool (2026-11-13: two 8 TB HDDs pooled by mergerfs).
 * `label` is the name that survives a reboot ("HDD 1"), from where the drive
 * is mounted rather than its sdX letter.
 */
export type DriveUsage = {
  label: string;
  mount: string;
  totalBytes: number;
  freeBytes: number;
  categories: Categories;
};

export type DiskUsage = {
  /** The pool as a whole (or the one drive, before the pool). */
  totalBytes: number;
  freeBytes: number;
  categories: Categories;
  /** Each drive of the pool; empty when /data is a single drive. */
  drives: DriveUsage[];
  generatedAt: string;
};

function categoriesOf(c: Partial<Categories> | undefined): Categories {
  return { movies: c?.movies ?? 0, tv: c?.tv ?? 0, roms: c?.roms ?? 0, torrents: c?.torrents ?? 0 };
}

/** The drives in a snapshot, keeping only entries that carry real numbers. */
export function parseDrives(raw: unknown): DriveUsage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((d) => {
    if (!d || typeof d !== "object") return [];
    const e = d as Partial<DriveUsage>;
    if (typeof e.label !== "string" || typeof e.totalBytes !== "number" || typeof e.freeBytes !== "number") return [];
    return [{ label: e.label, mount: typeof e.mount === "string" ? e.mount : "", totalBytes: e.totalBytes, freeBytes: e.freeBytes, categories: categoriesOf(e.categories) }];
  });
}

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
      categories: categoriesOf(body.categories),
      drives: parseDrives((body as { drives?: unknown }).drives),
      generatedAt: body.generatedAt ?? "",
    };
  } catch {
    return null;
  }
}
