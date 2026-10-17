/**
 * Translating TMDB's episode numbering to Sonarr's or Jellyfin's. Pure.
 *
 * Streamy's show pages number episodes the way TMDB does, while Sonarr and
 * Jellyfin follow TVDB, and the two don't always split a show into the same
 * seasons. Frieren is one 38-episode season on TMDB and two seasons (28 + 10)
 * on TVDB, so asking Sonarr for "S1E29" found nothing and the download
 * button failed straight to Retry (2026-10-17).
 *
 * Where the layouts agree, nothing is translated: an episode keeps its own
 * season and number. Only where they differ is an episode matched by its
 * position in the show -- the 29th regular episode on TMDB is the 29th on
 * TVDB. Specials (season 0) are never translated.
 */

export type EpisodeRef = { season: number; episode: number };
/** Regular season number -> how many episodes it has. */
export type SeasonCounts = Record<number, number>;

export function countsOf(refs: EpisodeRef[]): SeasonCounts {
  const counts: SeasonCounts = {};
  for (const r of refs) if (r.season > 0) counts[r.season] = (counts[r.season] ?? 0) + 1;
  return counts;
}

/** Whether both layouts have the same number of episodes in every regular season before `season`. */
function priorSeasonsAgree(tmdb: SeasonCounts, other: SeasonCounts, season: number): boolean {
  for (let s = 1; s < season; s++) if ((tmdb[s] ?? 0) !== (other[s] ?? 0)) return false;
  return true;
}

/** Regular episodes in show order. */
function inShowOrder<T extends EpisodeRef>(refs: T[]): T[] {
  return refs.filter((r) => r.season > 0).sort((a, b) => a.season - b.season || a.episode - b.episode);
}

/**
 * The other side's episode for TMDB's season/episode, or null when it has
 * none. `tmdb` null (TMDB unreachable) means no translation at all.
 */
export function toOtherNumbering<T extends EpisodeRef>(
  tmdb: SeasonCounts | null,
  other: T[],
  ref: EpisodeRef
): T | null {
  const direct = other.find((o) => o.season === ref.season && o.episode === ref.episode) ?? null;
  if (!tmdb || ref.season <= 0) return direct;
  const otherCounts = countsOf(other);
  if (priorSeasonsAgree(tmdb, otherCounts, ref.season) && direct) return direct;
  let position = ref.episode;
  for (let s = 1; s < ref.season; s++) position += tmdb[s] ?? 0;
  return inShowOrder(other)[position - 1] ?? null;
}

/**
 * The other side's episodes making up TMDB's season, in order, each with
 * the number TMDB gives it. The whole of the other side's season when the
 * layouts agree, so an episode TMDB doesn't list yet is still included, as
 * it always was.
 */
export function seasonInOtherNumbering<T extends EpisodeRef>(
  tmdb: SeasonCounts | null,
  other: T[],
  season: number
): { tmdbEpisode: number; other: T }[] {
  const same = () =>
    other
      .filter((o) => o.season === season)
      .sort((a, b) => a.episode - b.episode)
      .map((o) => ({ tmdbEpisode: o.episode, other: o }));
  if (!tmdb || season <= 0) return same();
  const otherCounts = countsOf(other);
  if (priorSeasonsAgree(tmdb, otherCounts, season) && (tmdb[season] ?? 0) <= (otherCounts[season] ?? 0)) {
    return same();
  }
  const out: { tmdbEpisode: number; other: T }[] = [];
  for (let e = 1; e <= (tmdb[season] ?? 0); e++) {
    const hit = toOtherNumbering(tmdb, other, { season, episode: e });
    if (hit) out.push({ tmdbEpisode: e, other: hit });
  }
  return out;
}
