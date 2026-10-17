/**
 * What a poster tile needs of a title, and nothing more.
 *
 * Title lookups return detail records that also carry the full cast, crew and
 * watch providers. Handed straight to a client row, every one of those rides
 * along in the page for every tile: My List with ~680 saved titles came to
 * 6.2 MB of page data (2026-10-17), almost all of it credits nobody sees on a
 * tile. Rows get these instead; the title page loads its own details.
 */
import type { Movie, TVShow } from "@/lib/tmdb";

export function toCardMovie(m: Movie): Movie {
  return {
    id: m.id,
    title: m.title,
    // Kept: the watch page paints it from the tile's cached copy before its
    // own details arrive (movieCache.ts).
    overview: m.overview,
    poster: m.poster,
    backdrop: m.backdrop,
    year: m.year,
    releaseDate: m.releaseDate,
    rating: m.rating,
    duration: m.duration,
    genres: m.genres,
  };
}

export function toCardShow<T extends TVShow>(s: T & { numberOfSeasons?: number }): TVShow & { numberOfSeasons: number } {
  return {
    id: s.id,
    name: s.name,
    overview: s.overview,
    poster: s.poster,
    backdrop: s.backdrop,
    year: s.year,
    releaseDate: s.releaseDate,
    rating: s.rating,
    genres: s.genres,
    numberOfSeasons: s.numberOfSeasons ?? 1,
  };
}
