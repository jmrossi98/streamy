import { getMovieById, getShowById } from "@/lib/tmdb";
import { RecentlyWatchedRow, type RecentItem } from "@/components/RecentlyWatchedRow";

type WatchProgressRow = { movieId: string | number; progressSeconds: number; updatedAt: Date };
type EpisodeProgressRow = { showId: string; updatedAt: Date };

/**
 * Continue Watching, resolved on its own rather than in the page body.
 *
 * It used to be a second `await` after the one that loads every row on the
 * page, and nothing rendered until it finished: six TMDB detail lookups --
 * which are `unstable_cache`d and therefore fast right up until the moment
 * they are not -- sat between the viewer and the first byte of HTML. On a
 * cache miss the hero, every genre row and the whole page shell waited on
 * three movies and three shows that occupy one strip near the top.
 *
 * Rendering it inside a Suspense boundary means the shell flushes on wave one
 * and this fills in when it is ready, so a cold detail cache costs a moment of
 * skeleton in one strip instead of the entire page's time to first byte.
 */
export async function RecentlyWatchedSection({
  recentProgress,
  recentShowIds,
  recentEpisodeProgress,
}: {
  recentProgress: WatchProgressRow[];
  recentShowIds: string[];
  recentEpisodeProgress: EpisodeProgressRow[];
}) {
  const [movieDetails, showDetails] = await Promise.all([
    Promise.all(recentProgress.map((p) => getMovieById(String(p.movieId)))),
    Promise.all(recentShowIds.map((id) => getShowById(id))),
  ]);

  // Movies and shows merged into one strip ordered by when each was last
  // watched (newest first), so a show watched minutes ago outranks an older
  // movie -- the "Continue Watching" ordering people expect.
  const recentMovieItems: RecentItem[] = recentProgress
    .map((p, i): RecentItem | null => {
      const movie = movieDetails[i];
      if (!movie) return null;
      return {
        kind: "movie",
        sortAt: new Date(p.updatedAt).getTime(),
        movie,
        progressSeconds: p.progressSeconds,
        runtimeMinutes: movie.runtime ?? null,
      };
    })
    .filter((item): item is RecentItem => item != null);

  const recentShowItems: RecentItem[] = recentShowIds
    .map((id, i): RecentItem | null => {
      const show = showDetails[i];
      if (!show) return null;
      const lastWatched = recentEpisodeProgress.find((p) => p.showId === id)?.updatedAt;
      return { kind: "show", sortAt: lastWatched ? new Date(lastWatched).getTime() : 0, show };
    })
    .filter((item): item is RecentItem => item != null);

  const items = [...recentMovieItems, ...recentShowItems].sort((a, b) => b.sortAt - a.sortAt);

  if (items.length === 0) return null;

  return <RecentlyWatchedRow items={items} />;
}

/**
 * Holds the strip's vertical space while the details resolve.
 *
 * Sized to match RecentlyWatchedRow rather than left empty on purpose: an
 * empty fallback lets the rows below jump upward and then back down when this
 * streams in, which is a layout shift the viewer sees as the page "bouncing"
 * -- a worse experience than the wait it replaced.
 */
export function RecentlyWatchedSkeleton() {
  return (
    <div className="px-4 sm:px-6 md:px-12" aria-hidden>
      <div className="mb-2 h-6 w-48 rounded bg-white/10" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="aspect-video w-[44vw] shrink-0 rounded bg-white/5 sm:w-[30vw] md:w-[22vw] lg:w-[16vw]"
          />
        ))}
      </div>
    </div>
  );
}
