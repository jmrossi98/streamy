/**
 * TMDB serves each image at fixed widths; `backdropUrl` hands out the
 * /original/ one (up to 3840 px, often 1-3 MB). The home hero loaded that on
 * every phone as its highest-priority image (2026-10-18). A srcset over
 * TMDB's own sizes lets the browser pick: w780 for a phone, w1280 for a
 * laptop, the original for a big desktop. Pure.
 *
 * The same goes for every other kind of TMDB artwork (2026-10-25). Posters
 * were handed out at w500 whatever the tile, and cast headshots went through
 * this server's image optimizer -- a fetch from TMDB plus a resize on the
 * production box for each of twenty faces, which is why a title's cast row
 * filled in long after the rest of the page. Every TMDB image is now a plain
 * <img> straight from TMDB's CDN with a srcset of TMDB's own sizes, so the
 * browser fetches one file, of about the size it will draw, with nothing in
 * between (see components/ui/Artwork.tsx).
 */
type Ladder = Array<[string, number]>;

const BACKDROP_WIDTHS: Ladder = [["w780", 780], ["w1280", 1280], ["original", 3840]];
/** Poster sizes TMDB offers; row tiles draw 160-240 CSS px, so up to w780 covers a 3x screen. */
const POSTER_WIDTHS: Ladder = [["w185", 185], ["w342", 342], ["w500", 500], ["w780", 780]];
/** Headshots: a 92 px circle needs w185 at 2x; h632 (about 421 px wide) covers the person page at 3x. */
const PROFILE_WIDTHS: Ladder = [["w185", 185], ["h632", 421]];
/** Episode stills: the list draws them 112-160 px wide. */
const STILL_WIDTHS: Ladder = [["w185", 185], ["w300", 300]];

export type ArtKind = "backdrop" | "poster" | "profile" | "still";

const LADDERS: Record<ArtKind, Ladder> = {
  backdrop: BACKDROP_WIDTHS,
  poster: POSTER_WIDTHS,
  profile: PROFILE_WIDTHS,
  still: STILL_WIDTHS,
};

/** The `/t/p/<size>/` segment of a TMDB image URL; nothing for any other host. */
const SIZE_SEGMENT = /\/t\/p\/(w\d+|h\d+|original)\//;

function srcSet(url: string, widths: Ladder): string | undefined {
  const m = SIZE_SEGMENT.exec(url);
  if (!m) return undefined;
  return widths.map(([size, w]) => `${url.replace(m[0], `/t/p/${size}/`)} ${w}w`).join(", ");
}

export function backdropSrcSet(originalUrl: string): string | undefined {
  // Only the original is worth re-sizing down; an already-sized backdrop was chosen on purpose.
  if (!originalUrl.includes("/original/")) return undefined;
  return srcSet(originalUrl, BACKDROP_WIDTHS);
}

/**
 * A srcset over TMDB's sizes for one kind of artwork, whatever size the URL
 * names, or undefined for a placeholder or any other host.
 */
export function artSrcSet(url: string, kind: ArtKind): string | undefined {
  if (kind === "backdrop") return backdropSrcSet(url);
  return srcSet(url, LADDERS[kind]);
}
