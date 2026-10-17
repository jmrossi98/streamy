/**
 * Whether a show counts as anime for the admin's My List: animated and
 * originally Japanese. TMDB has no anime genre, and "Animation" alone would
 * pull in The Simpsons; Japanese alone would pull in live-action dramas.
 */
export function isAnime(genres: string[], originalLanguage: string | null): boolean {
  return originalLanguage === "ja" && genres.includes("Animation");
}
