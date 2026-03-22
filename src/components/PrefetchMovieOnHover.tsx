"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { Movie } from "@/lib/tmdb";
import { setMovieInCache } from "@/lib/movieCache";

type Props = { movieId: string; movie?: Movie; children: React.ReactNode };

/** Registers list movie in cache so /watch/[id] can show info instantly. On hover, prefetches full details for play. */
export function PrefetchMovieOnHover({ movieId, movie, children }: Props) {
  const router = useRouter();
  useEffect(() => {
    if (movie) setMovieInCache(movieId, movie);
  }, [movieId, movie]);
  const onEnter = () => {
    fetch(`/api/movies/${movieId}`).catch(() => {});
    router.prefetch(`/watch/${movieId}`);
    router.prefetch(`/watch/${movieId}/play`);
  };
  return (
    <div className="h-full" onMouseEnter={onEnter}>
      {children}
    </div>
  );
}
