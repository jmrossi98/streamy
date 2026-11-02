/**
 * "Download new episodes as they air" for one show, in Sonarr's terms.
 *
 * Asked for 2026-11-02 after Potomac S11E4 had to be requested by hand the
 * day after it aired: episode requests monitor only the episodes asked for,
 * so the season stayed unmonitored and each new episode came in unwanted.
 *
 * Sonarr decides it with three settings, all kept here:
 *   - the newest season's monitored flag. An episode Sonarr adds later (TVDB
 *     lists most as "TBA" a week or two ahead) comes in monitored only when
 *     its season is.
 *   - the episodes already listed but not aired yet.
 *   - monitorNewItems, which decides whether a brand-new season starts
 *     monitored.
 *
 * Following never backfills: episodes already aired keep whatever they had,
 * so turning it on does not start downloading the rest of a season nobody
 * asked for, and turning it off does not stop a request still downloading.
 * That needs care, because Sonarr flips every episode of a season along with
 * the season's flag -- see followPlan.
 *
 * A show nobody has switched keeps Sonarr's default for brand-new seasons
 * (wanted -- the lookup Streamy adds shows from says monitorNewItems "all"),
 * so an unchecked box there means "not this season's new episodes". Turning
 * it off explicitly stops new seasons too.
 *
 * Pure: the Sonarr calls live in sonarr.ts (setNewEpisodeFollow).
 */

export type FollowSeason = { seasonNumber: number; monitored: boolean };

export type FollowEpisode = {
  id: number;
  seasonNumber: number;
  hasFile: boolean;
  monitored: boolean;
  /** ISO time; missing or null when TVDB has no date yet ("TBA"). */
  airDateUtc?: string | null;
};

/** The highest real season; specials (0) never count. Null with none. */
export function latestSeason(seasons: FollowSeason[]): number | null {
  const numbers = seasons.map((s) => s.seasonNumber).filter((n) => n > 0);
  return numbers.length > 0 ? Math.max(...numbers) : null;
}

/**
 * Whether a series gets new episodes on its own: monitored, and its newest
 * season monitored. A whole-show request, or a request for the newest whole
 * season, already reads as following -- correctly, both pick up new
 * episodes of that season.
 */
export function isFollowing(series: { monitored: boolean; seasons: FollowSeason[] }): boolean {
  const latest = latestSeason(series.seasons);
  if (latest == null || !series.monitored) return false;
  return series.seasons.some((s) => s.seasonNumber === latest && s.monitored);
}

/** Not aired yet: dated in the future, or not dated at all. Specials are never in scope. */
export function isUpcoming(episode: FollowEpisode, now: number): boolean {
  if (episode.seasonNumber === 0) return false;
  if (!episode.airDateUtc) return true;
  const at = Date.parse(episode.airDateUtc);
  return Number.isNaN(at) || at > now;
}

/** What each episode's monitored flag should be once following is switched `on` or off. */
export function wantedMonitoring(before: FollowEpisode, on: boolean, now: number): boolean {
  if (isUpcoming(before, now) && !before.hasFile) return on;
  return before.monitored;
}

/**
 * The episode flags to set after the series update, given every episode as it
 * was BEFORE it and as it is AFTER it. Sonarr flips a whole season's episodes
 * when the season's flag changes; this puts the aired ones back and sets the
 * upcoming ones, touching only what differs.
 */
export function followPlan(
  before: FollowEpisode[],
  after: FollowEpisode[],
  on: boolean,
  now: number
): { monitor: number[]; unmonitor: number[] } {
  const wanted = new Map(before.map((e) => [e.id, wantedMonitoring(e, on, now)]));
  const monitor: number[] = [];
  const unmonitor: number[] = [];
  for (const e of after) {
    // An episode that appeared in between: monitor it like the rest of its kind.
    const want = wanted.get(e.id) ?? wantedMonitoring(e, on, now);
    if (want && !e.monitored) monitor.push(e.id);
    if (!want && e.monitored) unmonitor.push(e.id);
  }
  return { monitor, unmonitor };
}

/** The series body to PUT: the newest season flagged `on`, and new seasons following suit. */
export function followSeriesUpdate<S extends { monitored: boolean; monitorNewItems?: string; seasons: FollowSeason[] }>(
  series: S,
  on: boolean
): S {
  const latest = latestSeason(series.seasons);
  return {
    ...series,
    // Off leaves the series itself monitored: episodes already asked for still need it.
    monitored: on ? true : series.monitored,
    monitorNewItems: on ? "all" : "none",
    seasons: series.seasons.map((s) => (s.seasonNumber === latest ? { ...s, monitored: on } : s)),
  };
}
