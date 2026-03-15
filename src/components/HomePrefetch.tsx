"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { setMovieInCache } from "@/lib/movieCache";

type Props = {
  movieIds: string[];
  showIds?: string[];
  runtimeIds?: string[];
};

/**
 * After the home page is idle, prefetch full movie details, watch/play/show routes,
 * and runtimes API so clicks and progress bars feel instant (Netflix-style).
 */
export function HomePrefetch({ movieIds, showIds = [], runtimeIds = [] }: Props) {
  const router = useRouter();
  const idsKey = movieIds.slice(0, 12).join(",");
  const showKey = showIds.slice(0, 6).join(",");
  const runtimeKey = runtimeIds.slice(0, 50).join(",");

  useEffect(() => {
    const ids = movieIds.slice(0, 12);
    const rids = runtimeIds.slice(0, 50);
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      ids.forEach((movieId) => {
        router.prefetch(`/watch/${movieId}`);
        router.prefetch(`/watch/${movieId}/play`);
        fetch(`/api/movies/${movieId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((movie) => {
            if (!cancelled && movie) setMovieInCache(movieId, movie);
          })
          .catch(() => {});
      });
      showIds.slice(0, 6).forEach((showId) => {
        router.prefetch(`/show/${showId}`);
      });
      if (rids.length > 0) {
        fetch(`/api/movies/runtimes?ids=${rids.join(",")}`).catch(() => {});
      }
    };

    const id =
      typeof requestIdleCallback !== "undefined"
        ? requestIdleCallback(run, { timeout: 3000 })
        : setTimeout(run, 500);

    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback !== "undefined" && typeof id === "number") {
        cancelIdleCallback(id);
      } else if (typeof id === "number") {
        clearTimeout(id);
      }
    };
  }, [idsKey, showKey, runtimeKey, movieIds, showIds, runtimeIds, router]);

  return null;
}
