/**
 * Which queued episode gets searched next.
 *
 * Separate from pendingEpisodeSearch.ts, which holds the rows, so the fairness
 * rule can be tested without a database -- the same split the other *Rules
 * modules use.
 */

export type QueuedSearch = {
  episodeId: number;
  seriesId: number;
  attempts: number;
};

/**
 * Picks the next episode, taking series in turn.
 *
 * `rows` must already be ordered by batch then position, so the first row for
 * any series is that series' next episode. That ordering is what keeps each
 * individual show arriving in episode order.
 *
 * Round-robin rather than one-season-at-a-time: a 64-episode season takes about
 * an hour to work through, and a show requested a minute later used to sit at
 * "starting" for all of it, indistinguishable from broken. Interleaving costs
 * each season some speed and gains every season a start.
 *
 * @param afterSeriesId the series served last; null to start from the earliest
 *                      requested.
 */
export function chooseNextSearch(
  rows: QueuedSearch[],
  afterSeriesId: number | null
): QueuedSearch | null {
  if (rows.length === 0) return null;

  // Series in the order they were first requested, so the rotation is stable
  // across calls rather than depending on row order within a series.
  const series: number[] = [];
  for (const row of rows) {
    if (!series.includes(row.seriesId)) series.push(row.seriesId);
  }

  // A series that has since left the queue gives indexOf -1, which lands the
  // rotation back at the start -- fair, and never stuck.
  const previous = afterSeriesId === null ? -1 : series.indexOf(afterSeriesId);
  for (let i = 1; i <= series.length; i += 1) {
    const seriesId = series[(previous + i + series.length) % series.length];
    const head = rows.find((row) => row.seriesId === seriesId);
    if (head) return head;
  }
  return null;
}

/** Just the counts the stuck rule needs, so it does not depend on the row type. */
export type QueueSize = { total: number; oldestWaitMinutes: number };

/**
 * A queue older than this has stopped moving rather than merely being long.
 *
 * A full season legitimately takes the better part of an hour, and the warden
 * runs every ten minutes, so this is not "the queue should be empty by now" --
 * it is "nothing has completed in long enough that a human should be told".
 */
export const STUCK_AFTER_MINUTES = 90;

/**
 * Whether a recovery pass should be reported as stuck.
 *
 * Age alone is not the signal. A long queue that is working through a backlog
 * is the system behaving correctly, and alerting on it would train the alert
 * to be ignored -- which is how the real stall went unnoticed for hours. So a
 * pass counts as stuck only when the head of the queue is old *and* this pass
 * failed to shift anything.
 */
export function isQueueStuck(
  before: QueueSize,
  after: QueueSize,
  thresholdMinutes: number = STUCK_AFTER_MINUTES
): boolean {
  if (after.total === 0) return false;
  const moved = after.total < before.total;
  return after.oldestWaitMinutes >= thresholdMinutes && !moved;
}

/** Just the fields the backlog rule reads off a Sonarr command. */
export type SonarrCommand = {
  name?: string;
  status?: string;
  started?: string | null;
  queued?: string | null;
};

/**
 * How long a search command may run before it stops counting as "busy".
 *
 * Sonarr searches finish in seconds to a couple of minutes. One that has been
 * started for longer than this is wedged rather than working, and treating it
 * as backlog is what let a single stuck command hold the whole ordered queue.
 */
export const STALE_COMMAND_MINUTES = 10;

/**
 * Outstanding searches that should actually hold the drain back.
 *
 * The backlog guard exists so the drain does not fill Sonarr's command queue
 * and starve RssSync. It is not meant to be a lock that any long-running
 * command can take forever: the healer fires one bulk EpisodeSearch for every
 * wanted-but-idle episode, and with a limit of one outstanding search that
 * single command blocked every queued season for as long as it ran -- while
 * the healer re-fired it on each page load. Forty-five episodes waited two
 * hours behind exactly that, never attempted once.
 *
 * So a command that has been started longer than the stale window is not
 * counted. Sonarr will finish or drop it on its own; blocking the user's
 * explicitly requested season on it in the meantime is the worse failure.
 */
export function countBlockingSearches(
  commands: SonarrCommand[],
  now: number = Date.now(),
  staleAfterMinutes: number = STALE_COMMAND_MINUTES
): number {
  return commands.filter((c) => {
    if (c.name !== "EpisodeSearch") return false;
    // A queued command is backlog, however long it has waited -- it is in
    // line, not stuck. Only a command that *started* and has been running too
    // long is wedged. The first version aged queued commands out as well, so
    // once Sonarr fell behind the guard stopped counting its own backlog and
    // the drain kept adding to it: thirty searches deep, with a newly
    // requested season buried at the back.
    if (c.status === "queued") return true;
    if (c.status !== "started") return false;
    const since = c.started ?? c.queued;
    if (!since) return true;
    const age = now - new Date(since).getTime();
    // An unparseable timestamp counts as busy: the guard should fail towards
    // holding back rather than towards piling on.
    if (!Number.isFinite(age)) return true;
    return age < staleAfterMinutes * 60_000;
  }).length;
}

/**
 * Whether Sonarr is still running the initial refresh of a series it just
 * added.
 *
 * That refresh ends with Sonarr's "post-add actions", which set every
 * episode's monitored flag from its season's -- and Streamy adds a series
 * with every season unmonitored, then marks just the requested episodes
 * wanted. Marking them before post-add has run is a race Sonarr wins a moment
 * later: The Vince Staples Show S2 was requested, all six episodes flipped
 * back to unmonitored, the season search skipped them, and the ordered queue
 * read "unmonitored" as "cancelled" and dropped them. The page showed "Not
 * downloaded" straight after "Download season".
 */
export function seriesRefreshPending(
  commands: (SonarrCommand & { body?: { seriesId?: number; seriesIds?: number[] } })[],
  seriesId: number
): boolean {
  return commands.some(
    (c) =>
      c.name === "RefreshSeries" &&
      (c.status === "queued" || c.status === "started") &&
      (c.body?.seriesId === seriesId || (c.body?.seriesIds ?? []).includes(seriesId))
  );
}

// ------------------------------------------------------------ batching

/**
 * Due episodes in one season at or above this count are searched with one
 * SeasonSearch instead of per episode.
 *
 * Measured 2026-09-28 on an idle Sonarr: one EpisodeSearch 8.7 s; a
 * SeasonSearch covering all 8 episodes of The Chair Company S1, 40 s -- about
 * 5 s an episode against 8.7, and one set of indexer queries instead of eight
 * (NZBgeek's API has a daily cap). Below three the saving does not pay for a
 * season query's larger result set.
 */
export const SEASON_SEARCH_MIN_EPISODES = 3;

/** Largest EpisodeSearch sent in one command, so one slow batch cannot hog a slot. */
export const MAX_EPISODES_PER_COMMAND = 10;

export type SearchCandidate = { episodeId: number; seriesId: number; seasonNumber: number };

export type PlannedSearch =
  | { kind: "season"; seriesId: number; seasonNumber: number; episodeIds: number[] }
  | { kind: "episodes"; seriesId: number; episodeIds: number[] };

/**
 * Turns due episodes into at most `slots` Sonarr search commands.
 *
 * Order does not matter any more (Jake, 2026-09-28: "we don't need to download
 * in order of episode number as long as we can speed up search/download
 * time"), so instead of one EpisodeSearch per episode, awaited one after
 * another, episodes are grouped by series and season: a big enough group is
 * one SeasonSearch, the rest one EpisodeSearch listing them all. Groups keep
 * the order of their oldest request, so the earliest ask still goes first.
 */
export function planSearches(candidates: SearchCandidate[], slots: number): PlannedSearch[] {
  if (slots <= 0) return [];
  const groups = new Map<string, SearchCandidate[]>();
  for (const c of candidates) {
    const key = `${c.seriesId}:${c.seasonNumber}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const plan: PlannedSearch[] = [];
  for (const group of groups.values()) {
    const { seriesId, seasonNumber } = group[0];
    const episodeIds = [...new Set(group.map((c) => c.episodeId))];
    // Season 0 is specials: a "season search" there matches nothing useful.
    if (episodeIds.length >= SEASON_SEARCH_MIN_EPISODES && seasonNumber > 0) {
      plan.push({ kind: "season", seriesId, seasonNumber, episodeIds });
    } else {
      for (let i = 0; i < episodeIds.length; i += MAX_EPISODES_PER_COMMAND) {
        plan.push({ kind: "episodes", seriesId, episodeIds: episodeIds.slice(i, i + MAX_EPISODES_PER_COMMAND) });
      }
    }
    if (plan.length >= slots) break;
  }
  return plan.slice(0, slots);
}
