/**
 * Database access for the ordered episode-search queue.
 *
 * Deliberately only the storage half: the searching itself lives in sonarr.ts,
 * which already owns the API client, the command poller and the
 * search-triggered bookkeeping. Splitting it the other way round -- a queue
 * module that calls Sonarr -- would have made the two files import each other.
 *
 * Why the queue exists at all is on the Prisma model.
 */
import { prisma } from "./db";
import { chooseNextSearch } from "./searchQueueRules";

export type PendingSearch = {
  episodeId: number;
  seriesId: number;
  attempts: number;
};

/** Dropped after this many failures, so one bad episode can't block a season. */
export const MAX_SEARCH_ATTEMPTS = 3;

/**
 * Adds a batch in the order given, which is the order it will be searched in.
 *
 * Episodes already queued are left alone rather than re-positioned: the common
 * way to get here twice is asking for a season that is already part-way
 * through, and restarting it from the top would search everything again.
 */
export async function enqueueEpisodeSearches(
  seriesId: number,
  episodeIds: number[]
): Promise<void> {
  if (episodeIds.length === 0) return;
  const enqueuedAt = new Date();
  // Sequential rather than createMany: skipDuplicates is unsupported on
  // SQLite, and the batches here are one season at a time.
  for (const [position, episodeId] of episodeIds.entries()) {
    try {
      await prisma.pendingEpisodeSearch.create({
        data: { episodeId, seriesId, position, enqueuedAt },
      });
    } catch {
      // Unique violation: already queued, which is the intended no-op.
    }
  }
}

/**
 * The next episode to search, taking series in turn.
 *
 * This used to drain one whole batch before starting the next, on the reasoning
 * that two half-downloaded seasons are worse than one finished one. That was
 * wrong in practice: a 64-episode season takes about an hour, so a show
 * requested a minute later sat at "starting" for the whole of it, looking
 * broken. Nobody waits an hour to find out their second request was fine.
 *
 * So each series advances one episode at a time, round-robin. Every show still
 * arrives in episode order -- which is the point of the queue -- and every show
 * starts within one search of being asked for.
 *
 * @param afterSeriesId the series served last, so the next call moves on. Null
 *                      starts from the series requested earliest.
 */
export async function nextPendingSearch(
  afterSeriesId: number | null = null
): Promise<PendingSearch | null> {
  // The whole queue, cheap at this size (a few hundred rows at worst) and the
  // only way to pick fairly across series in one round trip.
  const rows = await prisma.pendingEpisodeSearch.findMany({
    orderBy: [{ enqueuedAt: "asc" }, { position: "asc" }],
    select: { episodeId: true, seriesId: true, attempts: true },
  });
  return chooseNextSearch(rows, afterSeriesId);
}

export async function completePendingSearch(episodeId: number): Promise<void> {
  await prisma.pendingEpisodeSearch.deleteMany({ where: { episodeId } });
}

/**
 * Records a failure, removing the episode once it has used up its attempts.
 *
 * Returning the row to the queue on the first couple of failures is worth it:
 * the usual cause is Sonarr being briefly unreachable, which affects whatever
 * is at the head of the queue rather than that episode in particular.
 */
export async function failPendingSearch(episodeId: number): Promise<void> {
  const row = await prisma.pendingEpisodeSearch.findUnique({
    where: { episodeId },
    select: { attempts: true },
  });
  if (!row) return;
  if (row.attempts + 1 >= MAX_SEARCH_ATTEMPTS) {
    await prisma.pendingEpisodeSearch.deleteMany({ where: { episodeId } });
    return;
  }
  await prisma.pendingEpisodeSearch.update({
    where: { episodeId },
    data: { attempts: { increment: 1 } },
  });
}

/** Drops queued searches, for episodes or seasons that have been cancelled. */
export async function clearPendingSearches(episodeIds: number[]): Promise<void> {
  if (episodeIds.length === 0) return;
  await prisma.pendingEpisodeSearch.deleteMany({ where: { episodeId: { in: episodeIds } } });
}

/**
 * Every episode still waiting, in the order they will be searched.
 *
 * Used on resume to re-assert the in-memory "search triggered" marks, which
 * the restart destroyed along with the chain itself.
 */
export async function pendingSearchIds(): Promise<number[]> {
  try {
    const rows = await prisma.pendingEpisodeSearch.findMany({
      orderBy: [{ enqueuedAt: "asc" }, { position: "asc" }],
      select: { episodeId: true },
    });
    return rows.map((r) => r.episodeId);
  } catch {
    return [];
  }
}
