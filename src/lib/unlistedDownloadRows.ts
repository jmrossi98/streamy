/**
 * Downloads-panel rows for episodes of shows Sonarr can't hold. Pure.
 *
 * Those downloads never pass through Sonarr's queue or history, so the panel
 * read nothing of them: The Hateful Eight: Extended Version downloaded and
 * landed in the library with no row anywhere (2026-11-17). Their SABnzbd jobs
 * (tvJobRules.ts) and the searches still underway (unlistedGrabs.ts) are the
 * whole record, and this turns them into the rows the panel already draws --
 * folded under the show like any other, keyed "<tmdbId>:<season>:<episode>"
 * so a row keeps its place from search to download to file.
 */
import type { DownloadRow } from "@/components/DownloadsPanel";
import { parseTvJobName, type TvJob } from "./tvJobRules";

export type UnlistedJob = TvJob & { nzoId: string; failMessage?: string | null; sizeBytes?: number | null; completedAt?: string | null };
export type UnlistedSearchRow = { tmdbId: string; season: number; episode: number; folder: string; at: number };

/** Which job speaks for an episode: the one moving, then the one being filed, then the one done, then a failure. */
const RANK: Record<TvJob["state"], number> = { downloading: 5, queued: 4, processing: 3, completed: 2, failed: 1 };

/** "The Hateful Eight (2019)" -> "The Hateful Eight": the panel shows the year nowhere else. */
function showName(folder: string | null, fallback: string): string {
  return (folder ?? fallback).replace(/\s*\(\d{4}\)$/, "") || fallback;
}

const se = (s: number, e: number) => `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`;

/** The shows whose jobs carry no folder title (the first ones, #655): their TMDB names, to head their rows. */
export function showsNeedingNames(jobs: UnlistedJob[]): string[] {
  const ids = new Set<string>();
  for (const job of jobs) {
    const p = parseTvJobName(job.name);
    if (p && !p.folder) ids.add(p.tmdbId);
  }
  return [...ids];
}

export function unlistedDownloadRows(
  jobs: UnlistedJob[],
  searches: UnlistedSearchRow[],
  /** TMDB names by id, for jobs named without a folder title. */
  names: ReadonlyMap<string, string> = new Map()
): DownloadRow[] {
  const best = new Map<string, { job: UnlistedJob; tmdbId: string; season: number; episode: number; folder: string | null; release: string }>();
  for (const job of jobs) {
    const p = parseTvJobName(job.name);
    if (!p) continue;
    const key = `${p.tmdbId}:${p.season}:${p.episode}`;
    const held = best.get(key);
    if (!held || RANK[job.state] > RANK[held.job.state]) best.set(key, { job, ...p });
  }

  const rows: DownloadRow[] = [];
  for (const [key, { job, tmdbId, season, episode, folder, release }] of best) {
    const base = {
      queueId: null,
      externalId: -Number(tmdbId),
      title: release,
      mediaType: "show" as const,
      protocol: "usenet" as const,
      sizeBytes: job.sizeBytes ?? null,
      seriesTitle: showName(folder, names.get(tmdbId) ?? release),
      seasonNumber: season,
      episodeNumber: episode,
      downloadId: job.nzoId,
      unlisted: { key, nzoId: job.nzoId },
    };
    if (job.state === "completed") {
      rows.push({ ...base, progress: null, completed: true, addedAt: job.completedAt ?? null, startedAt: job.completedAt ?? null });
    } else if (job.state === "failed") {
      rows.push({ ...base, progress: null, completed: false, noRelease: true, notice: `Download failed${job.failMessage ? `: ${job.failMessage}` : ""}` });
    } else {
      rows.push({
        ...base,
        progress: job.state === "downloading" ? (job.progress ?? 0) : job.state === "queued" ? 0 : 100,
        completed: false,
        importing: job.state === "processing",
      });
    }
  }

  for (const s of searches) {
    const key = `${s.tmdbId}:${s.season}:${s.episode}`;
    if (best.has(key)) continue;
    const show = showName(s.folder, s.folder);
    rows.push({
      queueId: null,
      externalId: -Number(s.tmdbId),
      title: `${show} ${se(s.season, s.episode)}`,
      progress: null,
      mediaType: "show",
      completed: false,
      searching: true,
      startedAt: new Date(s.at).toISOString(),
      seriesTitle: show,
      seasonNumber: s.season,
      episodeNumber: s.episode,
      unlisted: { key, nzoId: null },
    });
  }
  return rows;
}
