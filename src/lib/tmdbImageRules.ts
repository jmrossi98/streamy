/**
 * TMDB serves each image at fixed widths; `backdropUrl` hands out the
 * /original/ one (up to 3840 px, often 1-3 MB). The home hero loaded that on
 * every phone as its highest-priority image (2026-10-18). A srcset over
 * TMDB's own sizes lets the browser pick: w780 for a phone, w1280 for a
 * laptop, the original for a big desktop. Pure.
 */
const WIDTHS: Array<[string, number]> = [["w780", 780], ["w1280", 1280], ["original", 3840]];

/** Row cards are at most 240 px wide, so w780 already covers a 3x screen. */
const CARD_WIDTHS: Array<[string, number]> = [["w300", 300], ["w780", 780]];

function srcSet(originalUrl: string, widths: Array<[string, number]>): string | undefined {
  if (!originalUrl.includes("/original/")) return undefined;
  return widths.map(([size, w]) => `${originalUrl.replace("/original/", `/${size}/`)} ${w}w`).join(", ");
}

export function backdropSrcSet(originalUrl: string): string | undefined {
  return srcSet(originalUrl, WIDTHS);
}

/**
 * Art for a 16:9 row card. Cards used to put the 2:3 poster in the 16:9 box
 * with object-cover, which cut off the top and bottom of every poster. The
 * backdrop is already 16:9; a title with no backdrop falls back to its whole
 * poster, letterboxed. Pure.
 */
export function cardArt(
  backdrop: string,
  poster: string
): { src: string; srcSet?: string; fit: "cover" | "contain" } {
  const set = srcSet(backdrop, CARD_WIDTHS);
  if (set) return { src: backdrop.replace("/original/", "/w780/"), srcSet: set, fit: "cover" };
  return { src: poster, fit: "contain" };
}
