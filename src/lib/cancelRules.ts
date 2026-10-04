/**
 * What a person's cancel has to stop, beyond the transfers already in the
 * queue. Pure.
 *
 * A cancel that only empties the queue is not a cancel: the title stays
 * wanted, so the next search grabs it again, and a search that is already
 * running grabs whatever it finds even for an unmonitored episode (a
 * user-invoked search ignores the monitored flag). Reported 2026-10-02 with
 * Beetlejuice: cancelled, and 107 episodes kept downloading.
 */

export type ArrCommand = {
  id?: number;
  name?: string;
  status?: string;
  body?: {
    seasonNumber?: number;
    seriesId?: number;
    seriesIds?: number[];
    episodeIds?: number[];
    movieIds?: number[];
  };
};

const SEARCH = /Search$/;
const LIVE = new Set(["queued", "started"]);

/** Ids of queued or running search commands that would grab for this series. */
export function seriesSearchesToCancel(commands: ArrCommand[], seriesId: number, episodeIds: number[]): number[] {
  const mine = new Set(episodeIds);
  return commands
    .filter(
      (c) =>
        c.id != null &&
        SEARCH.test(c.name ?? "") &&
        LIVE.has(c.status ?? "") &&
        (c.body?.seriesId === seriesId ||
          (c.body?.seriesIds ?? []).includes(seriesId) ||
          (c.body?.episodeIds ?? []).some((e) => mine.has(e)))
    )
    .map((c) => c.id!);
}

/**
 * Live searches that would grab for specific episodes: an EpisodeSearch naming
 * any of them, and -- when a whole season is being cancelled -- that season's
 * SeasonSearch. Other seasons' searches are left alone.
 */
export function episodeSearchesToCancel(
  commands: ArrCommand[],
  episodeIds: number[],
  wholeSeason: { seriesId: number; seasonNumber: number } | null
): number[] {
  const mine = new Set(episodeIds);
  return commands
    .filter(
      (c) =>
        c.id != null &&
        SEARCH.test(c.name ?? "") &&
        LIVE.has(c.status ?? "") &&
        ((c.body?.episodeIds ?? []).some((e) => mine.has(e)) ||
          (wholeSeason != null &&
            c.name === "SeasonSearch" &&
            c.body?.seriesId === wholeSeason.seriesId &&
            c.body?.seasonNumber === wholeSeason.seasonNumber))
    )
    .map((c) => c.id!);
}

/** The same for one movie. */
export function movieSearchesToCancel(commands: ArrCommand[], movieId: number): number[] {
  return commands
    .filter(
      (c) =>
        c.id != null &&
        SEARCH.test(c.name ?? "") &&
        LIVE.has(c.status ?? "") &&
        (c.body?.movieIds ?? []).includes(movieId)
    )
    .map((c) => c.id!);
}
