/**
 * Anime: animated and originally Japanese. TMDB has no anime genre, and
 * "Animation" alone would pull in The Simpsons; Japanese alone would pull in
 * live-action dramas.
 *
 * Shows that qualify carry "Anime" in their genres, so the TV tab's genre
 * rows, the genre shelves and every shelf's genre filter pick it up like any
 * TMDB genre.
 */
export const ANIME = "Anime";

/**
 * A stand-in genre id for the Anime shelf (/tv/browse/genre-990001). Outside
 * TMDB's range, and only offered over the downloaded library -- TMDB's own
 * discover lists cannot be asked for it.
 */
export const ANIME_GENRE = { id: 990001, name: ANIME };

export function isAnime(genres: string[], originalLanguage: string | null): boolean {
  return originalLanguage === "ja" && genres.includes("Animation");
}

/** The genres with "Anime" added when the show qualifies. */
export function withAnimeGenre(genres: string[], originalLanguage: string | null): string[] {
  return isAnime(genres, originalLanguage) && !genres.includes(ANIME) ? [...genres, ANIME] : genres;
}

/**
 * Tags every anime in a list. Only animated shows need the language lookup,
 * so a list of live-action shows costs nothing extra.
 */
export async function tagAnime<T extends { id: string; genres: string[] }>(
  shows: T[],
  originalLanguage: (id: string) => Promise<string | null>
): Promise<T[]> {
  return Promise.all(
    shows.map(async (s) =>
      s.genres.includes("Animation") ? { ...s, genres: withAnimeGenre(s.genres, await originalLanguage(s.id)) } : s
    )
  );
}
