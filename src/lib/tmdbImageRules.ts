/**
 * TMDB serves each image at fixed widths; `backdropUrl` hands out the
 * /original/ one (up to 3840 px, often 1-3 MB). The home hero loaded that on
 * every phone as its highest-priority image (2026-10-18). A srcset over
 * TMDB's own sizes lets the browser pick: w780 for a phone, w1280 for a
 * laptop, the original for a big desktop. Pure.
 */
const WIDTHS: Array<[string, number]> = [["w780", 780], ["w1280", 1280], ["original", 3840]];

export function backdropSrcSet(originalUrl: string): string | undefined {
  if (!originalUrl.includes("/original/")) return undefined;
  return WIDTHS.map(([size, w]) => `${originalUrl.replace("/original/", `/${size}/`)} ${w}w`).join(", ");
}
