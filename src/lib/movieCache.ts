"use client";

import type { Movie } from "@/lib/tmdb";

const cache = new Map<string, Movie>();

export function setMovieInCache(id: string, movie: Movie): void {
  cache.set(id, movie);
}

export function getMovieFromCache(id: string): Movie | undefined {
  return cache.get(id);
}
