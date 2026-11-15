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
 * season and number. Where they differ, the air date decides when both sides
 * have one: the episode that aired on the same day is the same episode,
 * whatever either side numbers it. Only without a date is an episode matched
 * by its position in the show -- the 29th regular episode on TMDB is the
 * 29th on TVDB. Specials (season 0) are never translated.
 *
 * Position alone was wrong for The Real Housewives of Potomac (2026-10-19):
 * TMDB counts one more episode in season 6 than TVDB does, so every later
 * season was shifted by one, and TMDB's S11E02 -- on disk in Sonarr as
 * S11E02 -- was reported as the unaired S11E03, "no release found".
 *
 * Matching counts are not enough either. SpongeBob's season 2 has 36
 * episodes on both sides, but TMDB counts "Christmas Who?" as episode 9
 * while TVDB files it as a special and adds "Gary Takes a Bath" at 20, so
 * episodes 9-22 were off by one: playing Shanghaied (TMDB E22) played The
 * Smoking Peanut (TVDB E22) (2026-10-31). So when both sides name the
 * episode and the names differ, the title decides first, if exactly one
 * episode on the other side (specials included) carries TMDB's title.
 */

export type EpisodeRef = {
  season: number;
  episode: number;
  /** When it aired, "2026-10-18", for matching across layouts that differ. */
  airDate?: string | null;
  /** The episode's name, for catching numbers that agree on count but not order. */
  title?: string | null;
};
/** Regular season number -> how many episodes it has. */
export type SeasonCounts = Record<number, number>;
/** "season:episode" -> air date, "11:2" -> "2026-10-18". */
export type AirDates = Record<string, string>;
/** "season:episode" -> episode name, "2:22" -> "Shanghaied". */
export type Titles = Record<string, string>;
/**
 * Regular season number -> TMDB's own episode numbers in it, in order.
 *
 * Nearly always 1..N, but some shows are numbered across the whole run:
 * Hunter x Hunter (2011) is 62 + 74 + 12 on TMDB with season 2 numbered
 * 63-136 (2026-11-14). Everything here assumed a season starts at episode 1,
 * so TMDB's S2E100 -- the 38th episode of the season -- was looked for at
 * position 100, and 62 of the season's 74 episodes showed as not downloaded
 * though every one was on disk.
 */
export type EpisodeNumbers = Record<number, number[]>;
/** TMDB's layout of a show: how its regular seasons are cut, and when each episode aired. */
export type TmdbLayout = { counts: SeasonCounts; airDates?: AirDates; titles?: Titles; numbers?: EpisodeNumbers };

export function airKey(season: number, episode: number): string {
  return `${season}:${episode}`;
}

/** "2026-10-18" from either a date or an ISO datetime; null when there is none. */
export function airDay(value: string | null | undefined): string | null {
  const day = value?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/**
 * A title reduced to what both sides spell alike: "Mermaid Man & Barnacle
 * Boy III" and "Mermaid Man and Barnacle Boy III" are one name. Null for a
 * placeholder ("Episode 5", "TBA"), which says nothing about which episode.
 */
export function titleKey(title: string | null | undefined): string | null {
  if (!title) return null;
  const key = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "")
    .replace(/ /g, "");
  if (!key || /^(episode|ep|part|chapter)\d+$/.test(key) || /^(tba|tbd|untitled)$/.test(key)) return null;
  return key;
}

/** True or false when both titles are real names; null when either can't say. */
export function sameTitle(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const ka = titleKey(a);
  const kb = titleKey(b);
  return ka && kb ? ka === kb : null;
}

/**
 * The one episode on the other side named like TMDB's episode, when the
 * episode at the same number is named something else. Null when the names
 * agree, either side has no name, or no single episode carries the title.
 */
function byTitle<T extends EpisodeRef>(tmdb: TmdbLayout, other: T[], ref: EpisodeRef, direct: T | null): T | null {
  const title = tmdb.titles?.[airKey(ref.season, ref.episode)];
  const key = titleKey(title);
  if (!key) return null;
  if (direct && sameTitle(direct.title, title) !== false) return null;
  const named = other.filter((o) => titleKey(o.title) === key);
  return named.length === 1 ? named[0] : null;
}

/** Whether any episode in TMDB's season is named differently at the same number on the other side. */
function titlesDisagree<T extends EpisodeRef>(tmdb: TmdbLayout, other: T[], season: number): boolean {
  return other.some((o) => o.season === season && sameTitle(o.title, tmdb.titles?.[airKey(season, o.episode)]) === false);
}

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

/** Whether TMDB numbers this season from somewhere other than 1 (see EpisodeNumbers). */
function numberedAcrossShow(tmdb: TmdbLayout, season: number): boolean {
  const numbers = tmdb.numbers?.[season];
  return !!numbers && numbers.length > 0 && numbers[0] !== 1;
}

/** Where TMDB's episode sits in its season, 1-based: S2E63 is the 1st of Hunter x Hunter's season 2. */
function placeInSeason(tmdb: TmdbLayout, season: number, episode: number): number {
  const at = tmdb.numbers?.[season]?.indexOf(episode) ?? -1;
  return at >= 0 ? at + 1 : episode;
}

/** TMDB's episode numbers in a season, in order: its own list, or 1..count. */
function tmdbNumbers(tmdb: TmdbLayout, season: number): number[] {
  const numbers = tmdb.numbers?.[season];
  if (numbers && numbers.length > 0) return numbers;
  return Array.from({ length: tmdb.counts[season] ?? 0 }, (_, i) => i + 1);
}

/**
 * The other side's episode for TMDB's season/episode, or null when it has
 * none. `tmdb` null (TMDB unreachable) means no translation at all.
 */
export function toOtherNumbering<T extends EpisodeRef>(
  tmdb: TmdbLayout | null,
  other: T[],
  ref: EpisodeRef
): T | null {
  const direct = other.find((o) => o.season === ref.season && o.episode === ref.episode) ?? null;
  if (!tmdb || ref.season <= 0) return direct;
  const acrossShow = numberedAcrossShow(tmdb, ref.season);
  // Across-show numbering: the same-numbered episode is no evidence either
  // way, so a matching title decides on its own.
  const named = byTitle(tmdb, other, ref, acrossShow ? null : direct);
  if (named) return named;
  const otherCounts = countsOf(other);
  // A season TMDB numbers across the show never shares numbers with the
  // other side's, however the counts line up: TMDB's S2E63 is no one's S2E63.
  if (!acrossShow && priorSeasonsAgree(tmdb.counts, otherCounts, ref.season) && direct) return direct;

  // The layouts differ somewhere before this episode. The day it aired is
  // the one thing both sides agree on, when both know it.
  const aired = tmdb.airDates?.[airKey(ref.season, ref.episode)];
  if (aired) {
    const sameDay = other.filter((o) => o.season > 0 && airDay(o.airDate) === aired);
    if (sameDay.length === 1) return sameDay[0];
    // Two episodes one night (a premiere, a double bill): the number decides.
    if (sameDay.length > 1 && direct && sameDay.includes(direct)) return direct;
  }

  let position = placeInSeason(tmdb, ref.season, ref.episode);
  for (let s = 1; s < ref.season; s++) position += tmdb.counts[s] ?? 0;
  return inShowOrder(other)[position - 1] ?? null;
}

/**
 * The other side's episodes making up TMDB's season, in order, each with
 * the number TMDB gives it. The whole of the other side's season when the
 * layouts agree, so an episode TMDB doesn't list yet is still included, as
 * it always was.
 */
export function seasonInOtherNumbering<T extends EpisodeRef>(
  tmdb: TmdbLayout | null,
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
  if (
    !numberedAcrossShow(tmdb, season) &&
    priorSeasonsAgree(tmdb.counts, otherCounts, season) &&
    (tmdb.counts[season] ?? 0) <= (otherCounts[season] ?? 0) &&
    !titlesDisagree(tmdb, other, season)
  ) {
    return same();
  }
  const out: { tmdbEpisode: number; other: T }[] = [];
  for (const e of tmdbNumbers(tmdb, season)) {
    const hit = toOtherNumbering(tmdb, other, { season, episode: e });
    if (hit) out.push({ tmdbEpisode: e, other: hit });
  }
  return out;
}
