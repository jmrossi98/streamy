/**
 * Pulls watch progress from the shared Jellyfin account (the Roku) into
 * Streamy, so everything that reads Streamy's own tables -- the show page's
 * Play/resume button, Continue Watching -- reflects what was watched there.
 * The other direction already happens on every Streamy save (the progress
 * routes push to Jellyfin).
 *
 * Per person: each Streamy user syncs only with their own Jellyfin account
 * (jellyfinAccounts.ts). A user without one is simply not synced.
 */
import { prisma } from "./db";
import { getJellyfinRecentActivity } from "./jellyfin";
import { jellyfinUserIdFor } from "./jellyfinAccounts";
import { jellyfinIsNewer } from "./progressSyncRules";

/** How often one user's pull may run; page loads are frequent, Roku sessions are not. */
const PULL_INTERVAL_MS = 60_000;
const lastPull = new Map<string, number>();

/** Treat a finished title as its full runtime, the way Streamy stores a completed watch. */
function storedSeconds(a: { seconds: number; played: boolean; runtimeSeconds: number | null }): number {
  return a.played ? (a.runtimeSeconds ?? a.seconds) : a.seconds;
}

export async function pullJellyfinProgress(userId: string): Promise<number> {
  const now = Date.now();
  if (now - (lastPull.get(userId) ?? 0) < PULL_INTERVAL_MS) return 0;
  lastPull.set(userId, now);

  const jellyfinUserId = await jellyfinUserIdFor(userId);
  if (!jellyfinUserId) return 0;
  const activity = await getJellyfinRecentActivity(jellyfinUserId);
  let updated = 0;
  for (const a of activity) {
    try {
      if (a.type === "Movie") {
        const row = await prisma.watchProgress.findUnique({ where: { userId_movieId: { userId, movieId: a.tmdbId } } });
        const streamy = row ? { seconds: row.progressSeconds, updatedAt: row.updatedAt } : null;
        if (!jellyfinIsNewer(streamy, { seconds: a.seconds, played: a.played, lastPlayedAt: a.lastPlayedAt })) continue;
        const seconds = storedSeconds(a);
        await prisma.watchProgress.upsert({
          where: { userId_movieId: { userId, movieId: a.tmdbId } },
          create: { userId, movieId: a.tmdbId, progressSeconds: seconds },
          update: { progressSeconds: seconds },
        });
        updated++;
      } else {
        const key = {
          userId,
          showId: a.tmdbId,
          seasonNumber: a.seasonNumber!,
          episodeNumber: a.episodeNumber!,
        };
        const row = await prisma.episodeProgress.findUnique({ where: { userId_showId_seasonNumber_episodeNumber: key } });
        const streamy = row ? { seconds: row.progressSeconds, updatedAt: row.updatedAt } : null;
        if (!jellyfinIsNewer(streamy, { seconds: a.seconds, played: a.played, lastPlayedAt: a.lastPlayedAt })) continue;
        const seconds = storedSeconds(a);
        await prisma.episodeProgress.upsert({
          where: { userId_showId_seasonNumber_episodeNumber: key },
          create: { ...key, progressSeconds: seconds },
          update: { progressSeconds: seconds },
        });
        updated++;
      }
    } catch (err) {
      console.error("[progress-sync] pull failed for one item:", err);
    }
  }
  return updated;
}

/**
 * For page loads: pull for the viewer, but never hold the page for more than
 * a moment -- when mediabox is slow or asleep, the page renders from
 * Streamy's own rows and the pull finishes in the background.
 */
export async function pullJellyfinProgressForPage(session: { user?: { id?: string } } | null): Promise<void> {
  const userId = session?.user?.id;
  if (!userId) return;
  await Promise.race([
    pullJellyfinProgress(userId).catch(() => 0),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}
