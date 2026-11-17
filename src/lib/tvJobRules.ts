/**
 * Episodes of shows Sonarr can't hold, downloaded through SABnzbd. Pure.
 *
 * A show TVDB doesn't list (The Hateful Eight: Extended Version, TMDB tv
 * 320534 -- a Netflix-only cut) never gets into Sonarr, so its episodes are
 * fetched straight from usenet and the SABnzbd job is named
 * "[tv tmdb:<id> s<season>e<episode>] <release>", in TMDB's numbering. As with
 * games (gameJobRules.ts) the name is the whole record: the show page reads
 * how far each episode has got from it, and the file lands under
 * /data/tv/<Title> (<year>) [tmdbid-<id>]/, where Jellyfin numbers episodes
 * as TMDB does. No table to keep in step with SABnzbd's own state.
 */
import type { EpisodeStatusMap } from "./sonarr";

// SABnzbd swaps the ":" for "_" in a job's name (it is a folder name too), so
// "[tv tmdb:320534 s1e1]" comes back as "[tv tmdb_320534 s1e1]".
const JOB = /^\[tv tmdb[:_](\d+) s(\d+)e(\d+)\] (.+)$/i;

export function tvJobName(tmdbId: string | number, season: number, episode: number, release: string): string {
  return `[tv tmdb:${tmdbId} s${season}e${episode}] ${release}`;
}

export function parseTvJobName(name: string): { tmdbId: string; season: number; episode: number; release: string } | null {
  const m = JOB.exec(name.trim());
  return m ? { tmdbId: m[1], season: Number(m[2]), episode: Number(m[3]), release: m[4] } : null;
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
  jobs: TvJob[]
): EpisodeStatusMap {
  const statuses: EpisodeStatusMap = {};
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
