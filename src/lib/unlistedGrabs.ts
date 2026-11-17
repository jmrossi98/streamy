/**
 * Episodes of shows Sonarr can't hold, fetched straight from usenet.
 * Server-only.
 *
 * Sonarr only holds what TVDB lists. A Netflix-only cut (The Hateful Eight:
 * Extended Version, TMDB tv 320534) or a show TVDB hasn't caught up with yet
 * would otherwise be undownloadable. Jake, 2026-11-17: "if they're available
 * it should be downloaded".
 *
 * So for those, a request does what Sonarr would: a Prowlarr text search per
 * episode (by "Show S01E02" and by the episode's own title, across TV and
 * Movies -- the Hateful Eight chapters are filed under Movies), the strict
 * match and ranking in unlistedReleaseRules.ts, and the best release handed to
 * SABnzbd under a "[tv tmdb:<id> s<N>e<N> {Title (Year)}]" name
 * (tvJobRules.ts). mediabox-infra's unlisted-tv-import.py files it in
 * /data/tv/<Title (Year)> [tmdbid-<id>]/, Jellyfin numbers it as TMDB does,
 * and the show page reads it from there and from SABnzbd (sonarr.ts
 * unlistedSeasonStatuses).
 *
 * A search asks every indexer and can take a minute, so a request answers at
 * once and the searches run behind it, one episode at a time. What is being
 * searched, and what was searched for nothing, is held here in memory: it
 * only has to outlive a page's polling, and a restart forgetting it costs a
 * "Searching" row, nothing more.
 */
import { isProwlarrConfigured, prowlarrTextSearch, PROWLARR_MOVIES, PROWLARR_TV } from "./prowlarr";
import { episodeQueries, TEXT_SEARCH_EVERY_MS } from "./textSearchRules";
import { rankUnlistedReleases, type UnlistedEpisode, type UnlistedResult } from "./unlistedReleaseRules";
import { parseTvJobName, showFolderTitle, tvJobName } from "./tvJobRules";
import { addSabNzbFile, listSabJobs, type SabJob } from "./sabnzbd";
import { getJellyfinSeasonEpisodesOnDisk } from "./jellyfin";
import { getOriginalLanguage, getSeason, getShowById } from "./tmdb";
import type { QualityTier } from "./qualityTier";

/** SABnzbd's category for these: one Sonarr and Radarr ignore, as for games. */
const CATEGORY = "software";
/** How many of the best releases are tried before an episode counts as not found. */
const TRIES = 5;

export type UnlistedSearch = {
  tmdbId: string;
  season: number;
  episode: number;
  /** "The Hateful Eight (2019)", for the downloads panel. */
  folder: string;
  state: "searching" | "notFound";
  at: number;
};

const searches = new Map<string, UnlistedSearch>();
const key = (tmdbId: string, season: number, episode: number) => `${tmdbId}:${season}:${episode}`;

function current(s: UnlistedSearch): boolean {
  return s.state === "searching" || Date.now() - s.at < TEXT_SEARCH_EVERY_MS;
}

/** Episodes of one season being searched for, or searched for nothing lately. */
export function unlistedSearchStates(tmdbId: string, season: number): Map<number, "searching" | "notFound"> {
  const out = new Map<number, "searching" | "notFound">();
  for (const s of searches.values()) {
    if (s.tmdbId === tmdbId && s.season === season && current(s)) out.set(s.episode, s.state);
  }
  return out;
}

/** Every episode being searched for right now, for the downloads panel. */
export function activeUnlistedSearches(): UnlistedSearch[] {
  return [...searches.values()].filter((s) => s.state === "searching");
}

export type UnlistedRequestResult = { ok: true } | { ok: false; error: string; notListed?: true };

/**
 * Starts fetching one episode, or every aired episode of a season when
 * `episode` is null, for a show Sonarr can't hold. Skips what is on disk,
 * already in SABnzbd, or being searched for.
 */
export async function requestUnlistedEpisodes(
  tmdbId: string,
  season: number,
  episode: number | null,
  tier: QualityTier
): Promise<UnlistedRequestResult> {
  if (!isProwlarrConfigured()) return { ok: false, error: "Prowlarr is not configured" };
  const [show, seasonData, language] = await Promise.all([
    getShowById(tmdbId).catch(() => null),
    getSeason(tmdbId, season).catch(() => null),
    getOriginalLanguage("tv", tmdbId).catch(() => null),
  ]);
  if (!show || !seasonData) return { ok: false, error: "TMDB doesn't list that season", notListed: true };

  const today = new Date().toISOString().slice(0, 10);
  const asked = seasonData.episodes.filter((e) =>
    episode == null ? e.airDate != null && e.airDate <= today : e.episodeNumber === episode
  );
  if (asked.length === 0) return { ok: false, error: "Nothing in that season has aired", notListed: true };

  const [onDisk, jobs] = await Promise.all([
    getJellyfinSeasonEpisodesOnDisk(tmdbId, season),
    listSabJobs().catch((): SabJob[] => []),
  ]);
  const have = new Set(onDisk);
  for (const j of jobs) {
    const p = parseTvJobName(j.name);
    if (p && p.tmdbId === tmdbId && p.season === season && j.state !== "failed") have.add(p.episode);
  }
  const wanted = asked.filter(
    (e) => !have.has(e.episodeNumber) && searches.get(key(tmdbId, season, e.episodeNumber))?.state !== "searching"
  );
  if (wanted.length === 0) return { ok: true };

  const folder = showFolderTitle(show.name, show.year);
  for (const e of wanted) {
    searches.set(key(tmdbId, season, e.episodeNumber), { tmdbId, season, episode: e.episodeNumber, folder, state: "searching", at: Date.now() });
  }
  void (async () => {
    // One at a time: each search already asks every indexer at once.
    for (const e of wanted) {
      const ep: UnlistedEpisode = {
        show: show.name,
        originalLanguage: language,
        season,
        episode: e.episodeNumber,
        episodeTitle: e.name || null,
        runtimeMinutes: e.runtime,
      };
      const k = key(tmdbId, season, e.episodeNumber);
      const grabbed = await grabEpisode(tmdbId, folder, ep, tier).catch((err) => {
        console.error(`[unlisted] ${folder} S${season}E${e.episodeNumber}: search failed:`, err);
        return false;
      });
      if (grabbed) searches.delete(k);
      else searches.set(k, { tmdbId, season, episode: e.episodeNumber, folder, state: "notFound", at: Date.now() });
    }
  })();
  return { ok: true };
}

/** Searches usenet for one episode and hands the best release that fetches to SABnzbd. */
async function grabEpisode(tmdbId: string, folder: string, ep: UnlistedEpisode, tier: QualityTier): Promise<boolean> {
  const results: UnlistedResult[] = [];
  for (const query of episodeQueries(ep.show, ep.season, ep.episode, ep.episodeTitle)) {
    results.push(...((await prowlarrTextSearch(query, [PROWLARR_TV, PROWLARR_MOVIES])) as UnlistedResult[]));
  }
  const ranked = rankUnlistedReleases(results, ep, tier);
  const label = `${folder} S${ep.season}E${ep.episode}`;
  if (ranked.length === 0) {
    console.log(`[unlisted] ${label}: no release among ${results.length} results`);
    return false;
  }
  for (const release of ranked.slice(0, TRIES)) {
    const nzb = await fetchNzb(release.downloadUrl!);
    if (!nzb) {
      // NZBgeek answers Lightsail's address with "IP not approved"; the next
      // indexer's copy of the same post usually fetches fine.
      console.warn(`[unlisted] ${label}: ${release.indexer ?? "an indexer"} gave no NZB for ${release.title}`);
      continue;
    }
    const nzoId = await addSabNzbFile(nzb, tvJobName(tmdbId, ep.season, ep.episode, release.title, folder), CATEGORY);
    if (nzoId) {
      console.log(`[unlisted] ${label}: sent ${release.title} (${release.indexer}) to SABnzbd`);
      return true;
    }
  }
  return false;
}

async function fetchNzb(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
    const body = res.ok ? await res.text() : "";
    return /<nzb[\s>]/i.test(body) ? body : null;
  } catch {
    return null;
  }
}
