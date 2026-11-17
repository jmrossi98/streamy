/**
 * Episodes of shows Sonarr can't hold, downloaded through SABnzbd. Pure.
 *
 * A show TVDB doesn't list (The Hateful Eight: Extended Version, TMDB tv
 * 320534 -- a Netflix-only cut) never gets into Sonarr, so its episodes are
 * fetched straight from usenet (unlistedGrabs.ts) and the SABnzbd job is named
 * "[tv tmdb:<id> s<season>e<episode> {<Title (Year)>}] <release>", in TMDB's
 * numbering. As with games (gameJobRules.ts) the name is the whole record: the
 * show page and the downloads panel read how far each episode has got from it,
 * and mediabox-infra's unlisted-tv-import.py files the finished download under
 * /data/tv/<Title (Year)> [tmdbid-<id>]/ -- the title rides along because
 * mediabox has no TMDB to ask -- where Jellyfin numbers episodes as TMDB does.
 * No table to keep in step with SABnzbd's own state.
 */
import type { EpisodeStatusMap } from "./sonarr";

// SABnzbd swaps the ":" for "_" in a job's name (it is a folder name too), so
// "[tv tmdb:320534 s1e1]" comes back as "[tv tmdb_320534 s1e1]".
// The folder title is optional: the first jobs (#655) were named without one.
const JOB = /^\[tv tmdb[:_](\d+) s(\d+)e(\d+)(?: \{([^{}]*)\})?\] (.+)$/i;

/**
 * "The Hateful Eight (2019)": the show's folder name, safe as a path and as a
 * SABnzbd job name -- no slashes, no characters SABnzbd rewrites (":" becomes
 * "_"), no braces to break the job name apart.
 */
export function showFolderTitle(name: string, year: string | number | null | undefined): string {
  const clean = name
    .replace(/\s*:\s*/g, " - ")
    .replace(/[\\/*?"<>|{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  const y = year != null && /^\d{4}$/.test(String(year).trim()) ? ` (${String(year).trim()})` : "";
  return `${clean || "Unknown show"}${y}`;
}

export function tvJobName(tmdbId: string | number, season: number, episode: number, release: string, folder?: string | null): string {
  return `[tv tmdb:${tmdbId} s${season}e${episode}${folder ? ` {${folder}}` : ""}] ${release}`;
}

export function parseTvJobName(
  name: string
): { tmdbId: string; season: number; episode: number; folder: string | null; release: string } | null {
  const m = JOB.exec(name.trim());
  return m ? { tmdbId: m[1], season: Number(m[2]), episode: Number(m[3]), folder: m[4] ?? null, release: m[5] } : null;
}

export type TvJob = { name: string; state: "queued" | "downloading" | "processing" | "completed" | "failed"; progress: number | null };

/** Which of an episode's jobs speaks for it: the one moving, then the one being filed. A failed job says nothing. */
const RANK: Record<TvJob["state"], number> = { downloading: 3, queued: 2, processing: 1, completed: 1, failed: 0 };

/**
 * One season's episode states for a show Sonarr can't hold: a file on disk
 * (Jellyfin) is "available"; otherwise its SABnzbd job says how far it has
 * got. Waiting in the queue reads as downloading at 0%, and unpacking or
 * waiting to be filed as 100% -- "requested" would read as still searching,
 * which it is not.
 */
export function unlistedShowStatuses(
  tmdbId: string,
  season: number,
  onDisk: number[],
  jobs: TvJob[],
  /** Being searched for (unlistedGrabs.ts), or searched for lately and not found. */
  searches: ReadonlyMap<number, "searching" | "notFound"> = new Map()
): EpisodeStatusMap {
  const statuses: EpisodeStatusMap = {};
  for (const [episode, state] of searches) {
    statuses[episode] = { status: state === "searching" ? "requested" : "noReleaseFound", progress: null };
  }
  const best = new Map<number, TvJob>();
  for (const job of jobs) {
    const parsed = parseTvJobName(job.name);
    if (!parsed || parsed.tmdbId !== tmdbId || parsed.season !== season || RANK[job.state] === 0) continue;
    const held = best.get(parsed.episode);
    if (!held || RANK[job.state] > RANK[held.state]) best.set(parsed.episode, job);
  }
  for (const [episode, job] of best) {
    statuses[episode] = {
      status: "downloading",
      progress: job.state === "downloading" ? (job.progress ?? 0) : job.state === "queued" ? 0 : 100,
    };
  }
  for (const n of onDisk) statuses[n] = { status: "available", progress: null };
  return statuses;
}
